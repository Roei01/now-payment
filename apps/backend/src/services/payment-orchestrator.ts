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

    const payment: PaymentRecord = {
      id: localPaymentId,
      businessId: input.businessId,
      amountILS: input.amountILS,
      cryptoCurrency: input.cryptoCurrency,
      network: input.network,
      description: input.description,
      customer: input.customer,
      nowPaymentId: nowPayment.paymentId,
      nowPaymentStatus: this.normalizeStatus(nowPayment.status),
      nowPayCurrency: nowPayment.payCurrency,
      payAmount: nowPayment.payAmount,
      payAddress: nowPayment.payAddress,
      qrCodeUrl: `https://api.qrserver.com/v1/create-qr-code/?size=420x420&data=${encodeURIComponent(
        nowPayment.payAddress,
      )}`,
      completionState: "pending",
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.repository.save(payment);

    return createPaymentResponseSchema.parse({
      payment_id: payment.id,
      pay_address: payment.payAddress,
      pay_amount: payment.payAmount,
      qr_code_url: payment.qrCodeUrl,
      status: payment.nowPaymentStatus,
    });
  }

  async getPaymentStatus(paymentId: string) {
    const payment = await this.repository.getById(paymentId);

    if (!payment) {
      throw new HttpError(404, "Payment not found.");
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
      throw new HttpError(401, "Missing NOWPayments signature.");
    }

    const parsedPayload = paymentWebhookSchema.parse(payload);
    this.nowPaymentsService.verifySignature(rawBody, parsedPayload, signature);

    const payment =
      (parsedPayload.order_id ? await this.repository.getById(parsedPayload.order_id) : null) ??
      (await this.repository.getByNowPaymentId(parsedPayload.payment_id));

    if (!payment) {
      throw new HttpError(404, "Unknown payment webhook.");
    }

    const updatedPayment = await this.repository.update(payment.id, (existing) => ({
      ...existing,
      nowPaymentStatus: this.normalizeStatus(parsedPayload.payment_status),
      payAmount: parsedPayload.pay_amount ?? existing.payAmount,
      nowPayCurrency: parsedPayload.pay_currency ?? existing.nowPayCurrency,
      updatedAt: new Date().toISOString(),
    }));

    if (!updatedPayment) {
      throw new HttpError(404, "Payment disappeared during webhook processing.");
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
        completionError: error instanceof Error ? error.message : "Unknown completion error.",
        updatedAt: new Date().toISOString(),
      }));

      throw error;
    }
  }

  private normalizeStatus(status: string): PaymentRecord["nowPaymentStatus"] {
    switch (status.toLowerCase()) {
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
