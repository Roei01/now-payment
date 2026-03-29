import type { PaymentRecord } from "@now-payment/shared";
import { google } from "googleapis";

import { env } from "../config/env.js";

export class GoogleSheetsService {
  async appendPayment(payment: PaymentRecord) {
    const auth = new google.auth.JWT({
      email: env.GOOGLE_CLIENT_EMAIL,
      key: env.GOOGLE_PRIVATE_KEY,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    await sheets.spreadsheets.values.append({
      spreadsheetId: env.GOOGLE_SHEET_ID,
      range: "Payments!A:F",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [
            payment.updatedAt,
            payment.amountILS,
            payment.cryptoCurrency,
            payment.payAmount,
            payment.nowPaymentStatus,
            payment.customer.fullName,
          ],
        ],
      },
    });
  }
}
