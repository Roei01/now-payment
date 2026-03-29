import crypto from "node:crypto";

import type {
  CreatePaymentInput,
  CryptoCurrency,
  PaymentNetwork,
  PaymentWebhookPayload,
} from "@now-payment/shared";
import axios, { AxiosInstance } from "axios";

import { env } from "../config/env.js";
import { HttpError } from "../lib/http-error.js";
import { logger } from "../lib/logger.js";

const fallbackPayCurrencies = ["usdttrc20", "btc"] as const;

const payCurrencyConfig: Record<
  CryptoCurrency,
  {
    defaultNetwork: PaymentNetwork;
    networks: Partial<Record<PaymentNetwork, string>>;
  }
> = {
  BTC: {
    defaultNetwork: "BTC",
    networks: {
      BTC: "btc",
    },
  },
  ETH: {
    defaultNetwork: "ETH",
    networks: {
      ETH: "eth",
      ERC20: "eth",
    },
  },
  USDT: {
    defaultNetwork: "TRC20",
    networks: {
      ERC20: "usdterc20",
      TRC20: "usdttrc20",
    },
  },
};

type CreatedNowPayment = {
  paymentId: string;
  payAddress: string;
  payAmount: number;
  payCurrency: string;
  status: string;
};

type NowPaymentsCreateRequest = {
  price_amount: number;
  price_currency: "usd";
  pay_currency: string;
  order_id: string;
  order_description: string;
  ipn_callback_url: string;
  customer_email: string;
};

type NowPaymentsCreateResponse = {
  payment_id?: number | string;
  pay_address?: string;
  pay_amount?: number;
  pay_currency?: string;
  payment_status?: string;
};

export class NowPaymentsService {
  private readonly client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: "https://api.nowpayments.io/v1",
      headers: {
        "x-api-key": env.NOWPAYMENTS_API_KEY,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });
  }

  async createPayment(
    input: CreatePaymentInput,
    localPaymentId: string,
  ): Promise<CreatedNowPayment> {
    if (input.amountILS <= 0) {
      throw new HttpError(400, "הסכום חייב להיות גדול מ-0.");
    }

    const payloadCandidates = this.buildPayloadCandidates(input, localPaymentId);
    let lastAxiosError: unknown = null;

    for (const [index, payload] of payloadCandidates.entries()) {

      logger.info({ payload }, "Creating NOWPayments payment");

      try {
        const createResponse = await this.client.post<NowPaymentsCreateResponse>(
          "/payment",
          payload,
        );
        const responseData = createResponse.data;

        if (!responseData.payment_id || !responseData.pay_address || !responseData.pay_amount) {
          throw new HttpError(
            502,
            "NOWPayments לא החזיר את כל פרטי התשלום הנדרשים.",
            responseData,
          );
        }

        return {
          paymentId: String(responseData.payment_id),
          payAddress: responseData.pay_address,
          payAmount: Number(responseData.pay_amount),
          payCurrency: responseData.pay_currency ?? payload.pay_currency,
          status: responseData.payment_status ?? "waiting",
        };
      } catch (error) {
        if (axios.isAxiosError(error)) {
          lastAxiosError = error;

          logger.error(
            {
              status: error.response?.status,
              data: error.response?.data,
              payload,
            },
            "NOWPayments create payment failed",
          );

          const shouldTryFallback =
            index < payloadCandidates.length - 1 &&
            this.shouldRetryWithFallback(error);

          if (shouldTryFallback) {
            logger.warn(
              {
                failedPayCurrency: payload.pay_currency,
                nextPayCurrency: payloadCandidates[index + 1]?.pay_currency,
              },
              "Retrying NOWPayments create payment with fallback currency",
            );
            continue;
          }

          throw new HttpError(
            error.response?.status === 400 ? 400 : 502,
            JSON.stringify(
              error.response?.data ?? { message: "Unknown NOWPayments error" },
            ),
          );
        }

        logger.error(
          { error, payload },
          "Unexpected NOWPayments create payment error",
        );
        throw new HttpError(
          502,
          JSON.stringify({ message: "Unknown NOWPayments error" }),
        );
      }
    }

    throw new HttpError(
      502,
      JSON.stringify(
        axios.isAxiosError(lastAxiosError)
          ? lastAxiosError.response?.data ?? {
              message: "Unknown NOWPayments error",
            }
          : { message: "Unknown NOWPayments error" },
      ),
    );
  }

  async createDevelopmentTestPayment() {
    const testInput: CreatePaymentInput = {
      businessId: "default",
      amountILS: 50,
      cryptoCurrency: "USDT",
      network: "TRC20",
      description: "Development NOWPayments test",
      customer: {
        fullName: "Development Test",
        email: "dev-test@example.com",
        phone: "0500000000",
      },
    };

    return this.createPayment(testInput, `dev-test-${Date.now()}`);
  }

  verifySignature(
    rawBody: string | undefined,
    payload: PaymentWebhookPayload,
    signature: string,
  ) {
    if (!rawBody) {
      throw new HttpError(400, "חסר גוף בקשה גולמי לצורך אימות הוובהוק.");
    }

    const sortedPayload = this.stableStringify(payload);
    const generated = crypto
      .createHmac("sha512", env.NOWPAYMENTS_IPN_SECRET)
      .update(sortedPayload)
      .digest("hex");

    const rawBodySignature = crypto
      .createHmac("sha512", env.NOWPAYMENTS_IPN_SECRET)
      .update(rawBody)
      .digest("hex");

    if (generated !== signature && rawBodySignature !== signature) {
      throw new HttpError(401, "חתימת הוובהוק של NOWPayments אינה תקינה.");
    }
  }

  private buildPayloadCandidates(
    input: CreatePaymentInput,
    localPaymentId: string,
  ): NowPaymentsCreateRequest[] {
    const primaryPayCurrency = this.resolvePayCurrency(
      input.cryptoCurrency,
      input.network,
    );
    const uniquePayCurrencies = [
      primaryPayCurrency,
      ...fallbackPayCurrencies,
    ].filter(
      (payCurrency, index, array) => array.indexOf(payCurrency) === index,
    );

    return uniquePayCurrencies.map((payCurrency) => ({
      price_amount: input.amountILS,
      price_currency: "usd",
      pay_currency: payCurrency,
      order_id: localPaymentId,
      order_description: input.description,
      ipn_callback_url: `${env.BACKEND_URL}/api/payment/webhook`,
      customer_email: input.customer.email,
    }));
  }

  private shouldRetryWithFallback(error: unknown) {
    if (!axios.isAxiosError(error)) {
      return false;
    }

    if (error.response?.status !== 400) {
      return false;
    }

    const errorText = JSON.stringify(error.response?.data ?? {}).toLowerCase();

    return /currency|network|pair|ticker|pay_currency|price_currency/.test(
      errorText,
    );
  }

  private resolvePayCurrency(
    currency: CreatePaymentInput["cryptoCurrency"],
    network?: PaymentNetwork,
  ) {
    const currencyConfig = payCurrencyConfig[currency];

    if (!currencyConfig) {
      throw new HttpError(400, "מטבע הקריפטו שנבחר אינו נתמך.");
    }

    const resolvedNetwork = network ?? currencyConfig.defaultNetwork;
    const payCurrency = currencyConfig.networks[resolvedNetwork];

    if (!payCurrency) {
      throw new HttpError(400, "השילוב בין המטבע לרשת אינו נתמך.");
    }

    return payCurrency;
  }

  private stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(",")}]`;
    }

    if (value && typeof value === "object") {
      const sortedEntries = Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right));

      return `{${sortedEntries
        .map(
          ([key, entryValue]) =>
            `${JSON.stringify(key)}:${this.stableStringify(entryValue)}`,
        )
        .join(",")}}`;
    }

    return JSON.stringify(value);
  }
}
