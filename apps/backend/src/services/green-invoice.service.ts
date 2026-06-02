import type { PaymentRecord } from "@now-payment/shared";
import axios, { AxiosInstance } from "axios";

import { env } from "../config/env.js";
import { HttpError } from "../lib/http-error.js";

type TokenCache = {
  value: string;
  expiresAt: number;
};

export class GreenInvoiceService {
  private readonly client: AxiosInstance;
  private tokenCache: TokenCache | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: "https://api.greeninvoice.co.il/api/v1",
      timeout: 15000,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  async createInvoiceReceipt(payment: PaymentRecord) {
    const token = await this.getToken();

    const today = new Date().toISOString().slice(0, 10);

    const remarks = this.buildRemarks(payment);

    const response = await this.client.post<{
      id?: string | number;
      documentId?: string | number;
      number?: number;
    }>(
      "/documents",
      {
        type: 400, // קבלה — supported for this business type
        lang: "he",
        currency: "ILS",
        vatType: 1, // exempt (עוסק פטור / no VAT on amount)
        date: today,
        client: {
          name: payment.customer.fullName,
          emails: [payment.customer.email],
          phone: payment.customer.phone,
        },
        sendEmail: true,
        remarks,
        income: [
          {
            description: payment.description,
            quantity: 1,
            price: payment.amountILS,
            currency: "ILS",
            vatType: 1,
          },
        ],
        payment: [
          {
            type: 4, // העברה בנקאית / crypto transfer
            price: payment.amountILS,
            currency: "ILS",
            date: today,
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    const invoiceId = response.data.id ?? response.data.documentId;

    if (!invoiceId) {
      throw new HttpError(502, "GreenInvoice לא החזיר מזהה קבלה.");
    }

    return String(invoiceId);
  }

  private buildRemarks(payment: PaymentRecord): string {
    const lines: string[] = ["פרטי עסקת קריפטו:"];

    const currency = payment.nowPayCurrency ?? payment.cryptoCurrency;
    const network = payment.network;
    lines.push(`מטבע: ${currency} (${network})`);

    if (payment.payAmount !== undefined) {
      lines.push(`סכום קריפטו ששולם: ${payment.payAmount} ${currency}`);
    }

    if (payment.usdExchangeRate !== undefined && payment.amountUSD !== undefined) {
      lines.push(`שער המרה: 1 USD = ${payment.usdExchangeRate.toFixed(2)} ₪`);
    }

    lines.push("");
    lines.push(`לפני מע"מ: ${payment.amountILS.toFixed(2)} ₪`);
    lines.push(`מע"מ (0%): 0.00 ₪`);
    lines.push(`סך הכל: ${payment.amountILS.toFixed(2)} ₪`);

    if (payment.payAddress) {
      lines.push("");
      lines.push(`ארנק שולח (Payin Address):`);
      lines.push(payment.payAddress);
    }

    if (payment.payoutAddress) {
      lines.push("");
      lines.push(`ארנק מקבל (Payout Address):`);
      lines.push(payment.payoutAddress);
    }

    if (payment.payinHash) {
      lines.push("");
      lines.push(`Hash כניסה (Payin Hash):`);
      lines.push(payment.payinHash);
    }

    if (payment.payoutHash) {
      lines.push("");
      lines.push(`Hash יציאה (Payout Hash):`);
      lines.push(payment.payoutHash);
    }

    return lines.join("\n");
  }

  private async getToken() {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now()) {
      return this.tokenCache.value;
    }

    const response = await this.client.post<{
      token?: string;
      jwt?: string;
      expires?: number;
      expiresIn?: number;
    }>("/account/token", {
      id: env.GREEN_API_KEY,
      secret: env.GREEN_API_SECRET,
    });

    const token = response.data.token ?? response.data.jwt;

    if (!token) {
      throw new HttpError(502, "אימות מול GreenInvoice נכשל ולא הוחזר טוקן.");
    }

    // Morning returns `expires` as an absolute unix timestamp (seconds).
    // Fall back to a relative `expiresIn`, then to a 1 hour default.
    const expiresAt = response.data.expires
      ? response.data.expires * 1000 - 60_000
      : Date.now() + (response.data.expiresIn ?? 3600) * 1000 - 60_000;

    this.tokenCache = {
      value: token,
      expiresAt,
    };

    return token;
  }
}
