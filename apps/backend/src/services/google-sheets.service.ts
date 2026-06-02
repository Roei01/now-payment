import type { PaymentRecord } from "@now-payment/shared";
import { google, type sheets_v4 } from "googleapis";

import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

// Column order aligned to the tracking sheet header row (A:P):
// A: # (running serial number, auto per row)
// B: Payment ID, C: Payment Extra IDs, D: Order ID, E: Original Price,
// F: Pay Price, G: Actually paid, H: Outcome Price, I: Status,
// J: Created at, K: Last update at, L: Payin address, M: Payin hash,
// N: Network Fee, O: Service Fee, P: Payout address
export class GoogleSheetsService {
  private sheetsClient: sheets_v4.Sheets | null = null;
  private resolvedTab: string | null = null;

  async appendPayment(payment: PaymentRecord) {
    const sheets = this.getClient();
    const sheetTab = await this.resolveSheetTab(sheets);
    const existingRow = await this.findPaymentRow(sheets, sheetTab, payment.id);

    if (existingRow) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: env.GOOGLE_SHEET_ID,
        range: `${sheetTab}!A${existingRow}:P${existingRow}`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [this.buildRow(payment)],
        },
      });

      logger.info(
        { paymentId: payment.id, sheetTab, row: existingRow },
        "Updated payment in Google Sheet",
      );
      return;
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: env.GOOGLE_SHEET_ID,
      range: `${sheetTab}!A:P`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [this.buildRow(payment)],
      },
    });

    logger.info({ paymentId: payment.id, sheetTab }, "Appended payment to Google Sheet");
  }

  private async findPaymentRow(
    sheets: sheets_v4.Sheets,
    sheetTab: string,
    paymentId: string,
  ): Promise<number | null> {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: env.GOOGLE_SHEET_ID,
      range: `${sheetTab}!D:D`,
    });

    const rows = response.data.values ?? [];
    const rowIndex = rows.findIndex((row) => row[0] === paymentId);

    return rowIndex >= 0 ? rowIndex + 1 : null;
  }

  private buildRow(payment: PaymentRecord): (string | number)[] {
    const cell = (value: string | number | undefined | null) =>
      value === undefined || value === null ? "" : value;

    return [
      "=ROW()-1", // A: running serial number based on the row position
      cell(payment.nowPaymentId), // B: Payment ID
      cell(payment.paymentExtraIds ?? payment.nowPurchaseId), // C: Payment Extra IDs
      cell(payment.id), // D: Order ID (the order_id we send to NOWPayments)
      cell(payment.priceAmount ?? payment.amountUSD), // E: Original Price (USD sent to NOWPayments)
      cell(payment.payAmount), // F: Pay Price (crypto)
      cell(payment.actuallyPaid ?? payment.payAmount), // G: Actually paid
      cell(payment.outcomeAmount), // H: Outcome Price
      cell(payment.nowPaymentStatus), // I: Status
      cell(payment.nowCreatedAt ?? payment.createdAt), // J: Created at
      cell(payment.nowUpdatedAt ?? payment.updatedAt), // K: Last update at
      cell(payment.payAddress), // L: Payin address
      cell(payment.payinHash), // M: Payin hash
      cell(payment.networkFee), // N: Network Fee
      cell(payment.serviceFee), // O: Service Fee
      cell(payment.payoutAddress), // P: Payout address
    ];
  }

  private getClient(): sheets_v4.Sheets {
    if (this.sheetsClient) {
      return this.sheetsClient;
    }

    const auth = new google.auth.JWT({
      email: env.GOOGLE_CLIENT_EMAIL,
      key: env.GOOGLE_PRIVATE_KEY,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    this.sheetsClient = google.sheets({ version: "v4", auth });
    return this.sheetsClient;
  }

  private async resolveSheetTab(sheets: sheets_v4.Sheets): Promise<string> {
    if (env.GOOGLE_SHEET_TAB) {
      return env.GOOGLE_SHEET_TAB;
    }

    if (this.resolvedTab) {
      return this.resolvedTab;
    }

    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: env.GOOGLE_SHEET_ID,
      fields: "sheets.properties.title",
    });

    this.resolvedTab = spreadsheet.data.sheets?.[0]?.properties?.title ?? "Sheet1";
    return this.resolvedTab;
  }
}
