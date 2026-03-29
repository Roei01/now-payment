import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { createApp } from "./app.js";
import { NowPaymentsService } from "./services/nowpayments.service.js";

const app = await createApp();

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "Backend listening");
});

if (env.NODE_ENV === "development") {
  const nowPaymentsService = new NowPaymentsService();

  void nowPaymentsService
    .createDevelopmentTestPayment()
    .then((payment) => {
      logger.info(
        {
          paymentId: payment.paymentId,
          payAddress: payment.payAddress,
          payAmount: payment.payAmount,
        },
        "Development NOWPayments test payment created",
      );
    })
    .catch((error) => {
      logger.error({ error }, "Development NOWPayments test payment failed");
    });
}
