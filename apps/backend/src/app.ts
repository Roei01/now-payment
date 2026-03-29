import cors from "cors";
import express from "express";
import type { Request } from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";

import { env } from "./config/env.js";
import { PaymentController } from "./controllers/payment.controller.js";
import { logger } from "./lib/logger.js";
import { errorMiddleware } from "./middleware/error.middleware.js";
import { notFoundMiddleware } from "./middleware/not-found.middleware.js";
import { PaymentRepository } from "./repositories/payment.repository.js";
import { createPaymentRouter } from "./routes/payment.routes.js";
import { GoogleSheetsService } from "./services/google-sheets.service.js";
import { GreenInvoiceService } from "./services/green-invoice.service.js";
import { NowPaymentsService } from "./services/nowpayments.service.js";
import { PaymentOrchestrator } from "./services/payment-orchestrator.js";

export async function createApp() {
  const repository = new PaymentRepository(env.paymentStorePath);
  await repository.init();

  const paymentOrchestrator = new PaymentOrchestrator(
    repository,
    new NowPaymentsService(),
    new GoogleSheetsService(),
    new GreenInvoiceService(),
  );

  const controller = new PaymentController(paymentOrchestrator);

  const app = express();

  app.use(
    pinoHttp({
      logger,
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin: env.BASE_URL,
      credentials: true,
    }),
  );
  app.use(
    express.json({
      limit: "1mb",
      verify: (request, _response, buffer) => {
        (request as Request).rawBody = buffer.toString("utf8");
      },
    }),
  );

  app.get("/api/health", (_request, response) => {
    response.status(200).json({
      status: "ok",
      service: "now-payment-backend",
    });
  });

  app.use("/api/payment", createPaymentRouter(controller));
  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}
