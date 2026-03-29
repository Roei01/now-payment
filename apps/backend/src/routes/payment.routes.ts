import { Router } from "express";

import type { PaymentController } from "../controllers/payment.controller.js";

export function createPaymentRouter(controller: PaymentController) {
  const router = Router();

  router.post("/create", controller.createPayment);
  router.post("/webhook", controller.receiveWebhook);
  router.get("/:paymentId", controller.getPaymentStatus);

  return router;
}
