import type { Request, Response } from "express";
import { createPaymentInputSchema } from "@now-payment/shared";

import { HttpError } from "../lib/http-error.js";
import type { PaymentOrchestrator } from "../services/payment-orchestrator.js";

export class PaymentController {
  constructor(private readonly paymentOrchestrator: PaymentOrchestrator) {}

  createPayment = async (request: Request, response: Response) => {
    const input = createPaymentInputSchema.parse(request.body);
    const payment = await this.paymentOrchestrator.createPayment(input);

    return response.status(201).json(payment);
  };

  getPaymentStatus = async (request: Request, response: Response) => {
    const paymentId = request.params.paymentId;

    if (!paymentId || Array.isArray(paymentId)) {
      throw new HttpError(400, "Payment ID is required.");
    }

    const payment = await this.paymentOrchestrator.getPaymentStatus(paymentId);
    return response.status(200).json(payment);
  };

  receiveWebhook = async (request: Request, response: Response) => {
    await this.paymentOrchestrator.handleWebhook(
      request.body,
      request.header("x-nowpayments-sig") ?? undefined,
      request.rawBody,
    );

    return response.status(200).json({ ok: true });
  };
}
