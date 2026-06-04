import crypto from "node:crypto";

import type {
  CreatePaymentInput,
  CryptoCurrency,
  PaymentNetwork,
} from "@now-payment/shared";
import axios, { AxiosInstance } from "axios";

import { env } from "../config/env.js";
import { HttpError } from "../lib/http-error.js";
import { logger } from "../lib/logger.js";

const fallbackPayCurrencies = ["usdttrc20", "btc"] as const;
const usdExchangeRateCacheTtlMs = 10 * 60 * 1000;

type UsdExchangeRate = {
  rate: number;
  fetchedAt: string;
};

let usdExchangeRateCache: (UsdExchangeRate & { expiresAt: number }) | null =
  null;

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
  USDC: {
    defaultNetwork: "ERC20",
    networks: {
      ERC20: "usdc",
    },
  },
};

type CreatedNowPayment = {
  invoiceId: string;
  paymentId?: string;
  purchaseId?: string;
  amountUSD: number;
  usdExchangeRate: number;
  usdExchangeRateFetchedAt: string;
  payAddress?: string;
  payAmount?: number;
  payCurrency?: string;
  paymentUrl: string;
  status: string;
};

type NowPaymentsCreateRequest = {
  price_amount: number;
  price_currency: "usd";
  pay_currency: string;
  order_id: string;
  order_description: string;
  ipn_callback_url: string;
  success_url: string;
  cancel_url: string;
};

type NowPaymentsCreateResponse = {
  id?: number | string;
  invoice_url?: string;
};

type NowPaymentsInvoicePaymentRequest = {
  iid: string;
  pay_currency: string;
  order_description: string;
  customer_email: string;
};

type NowPaymentsInvoicePaymentResponse = {
  payment_id?: number | string;
  purchase_id?: number | string;
  pay_address?: string;
  pay_amount?: number | string;
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

    const payloadCandidates = this.buildPayloadCandidates(
      input,
      localPaymentId,
    );
    const usdExchangeRate = await this.getUsdExchangeRate();
    const amountUSD = this.roundMoney(input.amountILS * usdExchangeRate.rate);
    let lastAxiosError: unknown = null;

    for (const [index, payloadCandidate] of payloadCandidates.entries()) {
      const payload = {
        ...payloadCandidate,
        price_amount: amountUSD,
      };

      logger.info({ payload }, "Creating NOWPayments invoice");

      try {
        const createResponse =
          await this.client.post<NowPaymentsCreateResponse>(
            "/invoice",
            payload,
          );
        const responseData = createResponse.data;

        if (!responseData.id || !responseData.invoice_url) {
          throw new HttpError(
            502,
            "NOWPayments לא החזיר קישור חשבונית תקין.",
            responseData,
          );
        }

        const invoiceId = String(responseData.id);
        const invoicePaymentBody = {
          iid: invoiceId,
          pay_currency: payload.pay_currency,
          order_description: payload.order_description,
          customer_email: input.customer.email,
        } satisfies NowPaymentsInvoicePaymentRequest;

        const invoicePaymentResponse =
          await this.client.post<NowPaymentsInvoicePaymentResponse>(
            "/invoice-payment",
            invoicePaymentBody,
          );
        const invoicePaymentData = invoicePaymentResponse.data;
        const payAmount =
          invoicePaymentData.pay_amount !== undefined
            ? Number(invoicePaymentData.pay_amount)
            : Number.NaN;

        if (
          !invoicePaymentData.payment_id ||
          !invoicePaymentData.pay_address ||
          !Number.isFinite(payAmount)
        ) {
          throw new HttpError(
            502,
            "NOWPayments לא החזיר את פרטי התשלום הפנימיים הנדרשים.",
            invoicePaymentData,
          );
        }

        return {
          invoiceId,
          paymentId: String(invoicePaymentData.payment_id),
          ...(invoicePaymentData.purchase_id
            ? { purchaseId: String(invoicePaymentData.purchase_id) }
            : {}),
          amountUSD,
          usdExchangeRate: usdExchangeRate.rate,
          usdExchangeRateFetchedAt: usdExchangeRate.fetchedAt,
          payAddress: invoicePaymentData.pay_address,
          payAmount,
          payCurrency: invoicePaymentData.pay_currency ?? payload.pay_currency,
          paymentUrl: responseData.invoice_url,
          status: invoicePaymentData.payment_status ?? "waiting",
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
            "NOWPayments create invoice failed",
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
          ? (lastAxiosError.response?.data ?? {
              message: "Unknown NOWPayments error",
            })
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
        phone: "05X-XXX-XXXX",
      },
    };

    return this.createPayment(testInput, `dev-test-${Date.now()}`);
  }

  verifySignature(rawBody: string | undefined, signature: string) {
    if (!rawBody) {
      throw new HttpError(400, "חסר גוף בקשה גולמי לצורך אימות הוובהוק.");
    }

    const secret = env.NOWPAYMENTS_IPN_SECRET;

    // NOWPayments signs the ORIGINAL JSON payload with its keys sorted
    // recursively (alphabetically), hashed via HMAC-SHA512 (hex digest).
    // We must rebuild the string from the untouched raw body — NOT from a
    // zod-parsed object, because parsing coerces types (string→number) and
    // drops null/undefined fields, which changes the bytes and breaks the
    // hash. That mismatch is exactly what produced the 401 loop.
    let sortedPayload: string;
    try {
      sortedPayload = this.stableStringify(JSON.parse(rawBody));
    } catch {
      throw new HttpError(400, "גוף הוובהוק של NOWPayments אינו JSON תקין.");
    }

    const generated = crypto
      .createHmac("sha512", secret)
      .update(sortedPayload)
      .digest("hex");

    const matches =
      generated.length === signature.length &&
      crypto.timingSafeEqual(Buffer.from(generated), Buffer.from(signature));

    if (!matches) {
      logger.warn(
        {
          secretConfigured: secret.length > 0,
          secretLength: secret.length,
          receivedSig: `${signature.slice(0, 12)}…`,
          generatedSig: `${generated.slice(0, 12)}…`,
          rawBodyLength: rawBody.length,
          sortedPayloadPreview: sortedPayload.slice(0, 200),
        },
        "NOWPayments webhook signature mismatch",
      );
      throw new HttpError(401, "חתימת הוובהוק של NOWPayments אינה תקינה.");
    }

    logger.info("NOWPayments webhook signature verified");
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
      price_amount: 0,
      price_currency: "usd",
      pay_currency: payCurrency,
      order_id: localPaymentId,
      order_description: input.description,
      ipn_callback_url: `${env.BACKEND_URL}/api/payment/webhook`,
      success_url: `${env.BASE_URL}/payment/${localPaymentId}`,
      cancel_url: `${env.BASE_URL}/payment/${localPaymentId}`,
    }));
  }

  private async getUsdExchangeRate(): Promise<UsdExchangeRate> {
    if (usdExchangeRateCache && usdExchangeRateCache.expiresAt > Date.now()) {
      return usdExchangeRateCache;
    }

    try {
      const response = await axios.get<{ rates?: { USD?: number } }>(
        "https://api.frankfurter.app/latest",
        {
          params: {
            from: "ILS",
            to: "USD",
          },
          timeout: 8000,
        },
      );
      const rate = response.data.rates?.USD;

      if (!rate || !Number.isFinite(rate) || rate <= 0) {
        throw new Error("Invalid USD exchange rate response");
      }

      const fetchedAt = new Date().toISOString();
      usdExchangeRateCache = {
        rate,
        fetchedAt,
        expiresAt: Date.now() + usdExchangeRateCacheTtlMs,
      };

      return usdExchangeRateCache;
    } catch (error) {
      logger.error({ error }, "Failed to fetch ILS to USD exchange rate");
      throw new HttpError(
        502,
        "לא הצלחנו לקבל שער דולר עדכני לצורך יצירת התשלום.",
      );
    }
  }

  private roundMoney(value: number) {
    return Math.round(value * 100) / 100;
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
