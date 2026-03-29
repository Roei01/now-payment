import crypto from "node:crypto";

import type { CreatePaymentInput, PaymentWebhookPayload } from "@now-payment/shared";
import axios, { AxiosInstance } from "axios";

import { env } from "../config/env.js";
import { HttpError } from "../lib/http-error.js";

const payCurrencyMap: Record<string, string> = {
  "BTC:BTC": "btc",
  "ETH:ETH": "eth",
  "ETH:ERC20": "eth",
  "USDT:ERC20": "usdterc20",
  "USDT:TRC20": "usdttrc20",
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
    const payCurrency = this.resolvePayCurrency(input.cryptoCurrency, input.network);

    const estimateResponse = await this.client.get<{
      estimated_amount: number;
    }>("/estimate", {
      params: {
        amount: input.amountILS,
        currency_from: "ils",
        currency_to: payCurrency,
      },
    });

    const createResponse = await this.client.post<{
      payment_id: number | string;
      pay_address: string;
      pay_amount: number;
      pay_currency: string;
      payment_status: string;
    }>("/payment", {
      price_amount: input.amountILS,
      price_currency: "ils",
      pay_currency: payCurrency,
      order_id: localPaymentId,
      order_description: input.description,
      ipn_callback_url: `${env.BACKEND_URL}/api/payment/webhook`,
      customer_email: input.customer.email,
      customer_phone: input.customer.phone,
      customer_name: input.customer.fullName,
      pay_amount: estimateResponse.data.estimated_amount,
    });

    return {
      paymentId: String(createResponse.data.payment_id),
      payAddress: createResponse.data.pay_address,
      payAmount: Number(createResponse.data.pay_amount),
      payCurrency: createResponse.data.pay_currency,
      status: createResponse.data.payment_status,
    };
  }

  verifySignature(rawBody: string | undefined, payload: PaymentWebhookPayload, signature: string) {
    if (!rawBody) {
      throw new HttpError(400, "Missing raw request body for webhook verification.");
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
      throw new HttpError(401, "Invalid NOWPayments webhook signature.");
    }
  }

  private resolvePayCurrency(currency: CreatePaymentInput["cryptoCurrency"], network: string) {
    const key = `${currency}:${network}`;
    const payCurrency = payCurrencyMap[key];

    if (!payCurrency) {
      throw new HttpError(400, "Unsupported crypto and network combination.");
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
