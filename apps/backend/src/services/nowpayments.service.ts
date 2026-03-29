import crypto from "node:crypto";

import type { CreatePaymentInput, CryptoCurrency, PaymentNetwork, PaymentWebhookPayload } from "@now-payment/shared";
import axios, { AxiosInstance } from "axios";

import { env } from "../config/env.js";
import { HttpError } from "../lib/http-error.js";
import { logger } from "../lib/logger.js";

const defaultUsdtPayCurrency = "usdttrc20";

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
      ERC20: defaultUsdtPayCurrency,
      TRC20: defaultUsdtPayCurrency,
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

  async createPayment(input: CreatePaymentInput, localPaymentId: string): Promise<CreatedNowPayment> {
    if (input.amountILS <= 0) {
      throw new HttpError(400, "הסכום חייב להיות גדול מ-0.");
    }

    const payCurrency = this.resolvePayCurrency(input.cryptoCurrency, input.network);
    const payload = {
      price_amount: input.amountILS,
      price_currency: "ils" as const,
      pay_currency: payCurrency,
      order_id: localPaymentId,
      order_description: input.description,
      ipn_callback_url: `${env.BACKEND_URL}/api/payment/webhook`,
      customer_email: input.customer.email,
      customer_phone: input.customer.phone,
      customer_name: input.customer.fullName,
    };

    if (env.NODE_ENV !== "production") {
      logger.debug({ payload }, "Creating payment with NOWPayments");
    }

    try {
      const createResponse = await this.client.post<{
        payment_id: number | string;
        pay_address: string;
        pay_amount: number;
        pay_currency: string;
        payment_status: string;
      }>("/payment", payload);

      return {
        paymentId: String(createResponse.data.payment_id),
        payAddress: createResponse.data.pay_address,
        payAmount: Number(createResponse.data.pay_amount),
        payCurrency: createResponse.data.pay_currency,
        status: createResponse.data.payment_status,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error(
          {
            status: error.response?.status,
            data: error.response?.data,
            payload,
          },
          "NOWPayments create payment failed",
        );

        throw new HttpError(error.response?.status === 400 ? 400 : 502, "לא הצלחנו ליצור תשלום.");
      }

      logger.error({ error, payload }, "Unexpected NOWPayments create payment error");
      throw new HttpError(502, "לא הצלחנו ליצור תשלום.");
    }
  }

  verifySignature(rawBody: string | undefined, payload: PaymentWebhookPayload, signature: string) {
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

  private resolvePayCurrency(currency: CreatePaymentInput["cryptoCurrency"], network?: PaymentNetwork) {
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
        .map(([key, entryValue]) => `${JSON.stringify(key)}:${this.stableStringify(entryValue)}`)
        .join(",")}}`;
    }

    return JSON.stringify(value);
  }
}
