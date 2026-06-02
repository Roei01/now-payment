import { randomUUID } from "node:crypto";

import {
  createPaymentResponseSchema,
  paymentStatusResponseSchema,
  paymentWebhookSchema,
  type CreatePaymentInput,
  type PaymentRecord,
} from "@now-payment/shared";

import { HttpError } from "../lib/http-error.js";
import { logger } from "../lib/logger.js";
import { PaymentRepository } from "../repositories/payment.repository.js";
import { GoogleSheetsService } from "./google-sheets.service.js";
import { GreenInvoiceService } from "./green-invoice.service.js";
import { NowPaymentsService } from "./nowpayments.service.js";

export class PaymentOrchestrator {
  constructor(
    private readonly repository: PaymentRepository,
    private readonly nowPaymentsService: NowPaymentsService,
    private readonly googleSheetsService: GoogleSheetsService,
    private readonly greenInvoiceService: GreenInvoiceService,
  ) {}

  async createPayment(input: CreatePaymentInput) {
    const localPaymentId = randomUUID();
    const nowPayment = await this.nowPaymentsService.createPayment(input, localPaymentId);
    const timestamp = new Date().toISOString();
    const paymentUrl = nowPayment.paymentUrl;
    const qrCodePayload = nowPayment.payAddress ?? paymentUrl;

    const payment: PaymentRecord = {
      id: localPaymentId,
      businessId: input.businessId,
      amountILS: input.amountILS,
      amountUSD: nowPayment.amountUSD,
      priceAmount: nowPayment.amountUSD,
      usdExchangeRate: nowPayment.usdExchangeRate,
      usdExchangeRateFetchedAt: nowPayment.usdExchangeRateFetchedAt,
      cryptoCurrency: input.cryptoCurrency,
      network: input.network,
      description: input.description,
      customer: input.customer,
      nowInvoiceId: nowPayment.invoiceId,
      ...(nowPayment.paymentId ? { nowPaymentId: nowPayment.paymentId } : {}),
      ...(nowPayment.purchaseId ? { nowPurchaseId: nowPayment.purchaseId } : {}),
      nowPaymentStatus: this.normalizeStatus(nowPayment.status),
      ...(nowPayment.payCurrency ? { nowPayCurrency: nowPayment.payCurrency } : {}),
      ...(nowPayment.payAmount ? { payAmount: nowPayment.payAmount } : {}),
      ...(nowPayment.payAddress ? { payAddress: nowPayment.payAddress } : {}),
      paymentUrl,
      qrCodeUrl: `https://api.qrserver.com/v1/create-qr-code/?size=420x420&data=${encodeURIComponent(
        qrCodePayload,
      )}`,
      completionState: "pending",
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.repository.save(payment);
    await this.googleSheetsService.appendPayment(payment);
    await this.repository.update(payment.id, (existing) => ({
      ...existing,
      sheetsSyncedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    return createPaymentResponseSchema.parse({
      payment_id: payment.id,
      payment_url: payment.paymentUrl,
      qr_code_url: payment.qrCodeUrl,
      status: payment.nowPaymentStatus,
      ...(payment.payAddress ? { pay_address: payment.payAddress } : {}),
      ...(payment.payAmount !== undefined ? { pay_amount: payment.payAmount } : {}),
      ...(payment.nowPayCurrency ? { pay_currency: payment.nowPayCurrency } : {}),
    });
  }

  async getPaymentStatus(paymentId: string) {
    const payment = await this.repository.getById(paymentId);

    if (!payment) {
      throw new HttpError(404, "התשלום לא נמצא.");
    }

    if (payment.nowPaymentStatus === "finished" && payment.completionState !== "completed") {
      void this.finalizePayment(payment.id).catch((error) => {
        logger.error({ error, paymentId: payment.id }, "Background finalization failed");
      });
    }

    return paymentStatusResponseSchema.parse(payment);
  }

  async handleWebhook(payload: unknown, signature: string | undefined, rawBody: string | undefined) {
    if (!signature) {
      throw new HttpError(401, "חסרה חתימת אימות של NOWPayments.");
    }

    const parsedPayload = paymentWebhookSchema.parse(payload);
    this.nowPaymentsService.verifySignature(rawBody, parsedPayload, signature);

    const payment =
      (parsedPayload.order_id ? await this.repository.getById(parsedPayload.order_id) : null) ??
      (parsedPayload.payment_id
        ? await this.repository.getByNowPaymentId(parsedPayload.payment_id)
        : null);

    if (!payment) {
      throw new HttpError(404, "התשלום של הוובהוק לא נמצא.");
    }

    const updatedPayment = await this.repository.update(payment.id, (existing) => {
      const updated: PaymentRecord = {
        ...existing,
        nowPaymentStatus: this.normalizeStatus(parsedPayload.payment_status),
        updatedAt: new Date().toISOString(),
      };

      if (parsedPayload.payment_id) {
        updated.nowPaymentId = parsedPayload.payment_id;
      }

      if (parsedPayload.invoice_id) {
        updated.nowInvoiceId = parsedPayload.invoice_id;
      }

      if (parsedPayload.pay_amount !== undefined) {
        updated.payAmount = parsedPayload.pay_amount;
      }

      if (parsedPayload.pay_currency) {
        updated.nowPayCurrency = parsedPayload.pay_currency;
      }

      if (parsedPayload.pay_address) {
        updated.payAddress = parsedPayload.pay_address;
      }

      if (parsedPayload.purchase_id) {
        updated.nowPurchaseId = parsedPayload.purchase_id;
      }

      if (parsedPayload.price_amount !== undefined) {
        updated.priceAmount = parsedPayload.price_amount;
      }

      if (parsedPayload.actually_paid !== undefined) {
        updated.actuallyPaid = parsedPayload.actually_paid;
      }

      if (parsedPayload.outcome_amount !== undefined) {
        updated.outcomeAmount = parsedPayload.outcome_amount;
      }

      if (parsedPayload.outcome_currency) {
        updated.outcomeCurrency = parsedPayload.outcome_currency;
      }

      const extraIds = this.normalizeExtraIds(parsedPayload.payment_extra_ids);
      if (extraIds) {
        updated.paymentExtraIds = extraIds;
      }

      if (parsedPayload.payin_hash) {
        updated.payinHash = parsedPayload.payin_hash;
      }

      if (parsedPayload.payout_address) {
        updated.payoutAddress = parsedPayload.payout_address;
      }

      const networkFee = parsedPayload.network_fee ?? parsedPayload.fee?.withdrawalFee;
      if (networkFee !== undefined) {
        updated.networkFee = networkFee;
      }

      const serviceFee = parsedPayload.service_fee ?? parsedPayload.fee?.serviceFee;
      if (serviceFee !== undefined) {
        updated.serviceFee = serviceFee;
      }

      if (parsedPayload.created_at) {
        updated.nowCreatedAt = parsedPayload.created_at;
      }

      if (parsedPayload.updated_at) {
        updated.nowUpdatedAt = parsedPayload.updated_at;
      }

      return updated;
    });

    if (!updatedPayment) {
      throw new HttpError(404, "התשלום לא נמצא במהלך עיבוד הוובהוק.");
    }

    if (updatedPayment.nowPaymentStatus === "finished") {
      await this.finalizePayment(updatedPayment.id);
    }

    return updatedPayment;
  }

  private async finalizePayment(paymentId: string) {
    const payment = await this.repository.getById(paymentId);

    if (!payment || payment.completionState === "completed") {
      return;
    }

    const processingPayment = await this.repository.update(payment.id, (existing) => ({
      ...existing,
      completionState: "processing",
      completionError: undefined,
      updatedAt: new Date().toISOString(),
    }));

    if (!processingPayment) {
      return;
    }

    try {
      await this.googleSheetsService.appendPayment(processingPayment);
      const invoiceId = await this.greenInvoiceService.createInvoiceReceipt(processingPayment);

      await this.repository.update(processingPayment.id, (existing) => ({
        ...existing,
        invoiceId,
        sheetsSyncedAt: new Date().toISOString(),
        completionState: "completed",
        completionProcessedAt: new Date().toISOString(),
        completionError: undefined,
        updatedAt: new Date().toISOString(),
      }));
    } catch (error) {
      logger.error({ error, paymentId }, "Failed to finalize payment");

      await this.repository.update(processingPayment.id, (existing) => ({
        ...existing,
        completionState: "failed",
        completionError: error instanceof Error ? error.message : "אירעה שגיאה לא ידועה בהשלמת התשלום.",
        updatedAt: new Date().toISOString(),
      }));

      throw error;
    }
  }

  private normalizeExtraIds(value: unknown): string | undefined {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }

    if (Array.isArray(value)) {
      const joined = value.map((item) => String(item)).join(", ");
      return joined.length > 0 ? joined : undefined;
    }

    if (typeof value === "object") {
      return JSON.stringify(value);
    }

    return String(value);
  }

  private normalizeStatus(status: string | undefined): PaymentRecord["nowPaymentStatus"] {
    switch ((status ?? "").toLowerCase()) {
      case "finished":
        return "finished";
      case "confirming":
      case "confirmed":
      case "sending":
      case "verifying":
        return "confirming";
      case "expired":
        return "expired";
      case "failed":
        return "failed";
      case "refunded":
        return "refunded";
      case "partially_paid":
        return "partially_paid";
      default:
        return "waiting";
    }
  }
}
