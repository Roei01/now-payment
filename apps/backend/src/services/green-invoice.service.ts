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

    const response = await this.client.post<{
      id?: string | number;
      documentId?: string | number;
    }>(
      "/documents",
      {
        type: 320,
        lang: "en",
        currency: "ILS",
        remarks: payment.description,
        client: {
          name: payment.customer.fullName,
          emails: [payment.customer.email],
          phone: payment.customer.phone,
        },
        sendEmail: true,
        emailContent: {
          subject: `Invoice receipt for ${payment.description}`,
          body: `Thanks for paying ${payment.amountILS} ILS with crypto.`,
        },
        income: [
          {
            catalogNum: payment.id,
            description: payment.description,
            quantity: 1,
            price: payment.amountILS,
            currency: "ILS",
            vatType: 0,
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
      throw new HttpError(502, "GreenInvoice did not return an invoice identifier.");
    }

    return String(invoiceId);
  }

  private async getToken() {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now()) {
      return this.tokenCache.value;
    }

    const response = await this.client.post<{
      token?: string;
      jwt?: string;
      expiresIn?: number;
    }>("/account/login", {
      id: env.GREEN_API_KEY,
      secret: env.GREEN_API_SECRET,
    });

    const token = response.data.token ?? response.data.jwt;

    if (!token) {
      throw new HttpError(502, "GreenInvoice authentication did not return a token.");
    }

    this.tokenCache = {
      value: token,
      expiresAt: Date.now() + (response.data.expiresIn ?? 3600) * 1000 - 60_000,
    };

    return token;
  }
}
