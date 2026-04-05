import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { createApp } from "./app.js";

const app = await createApp();

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "Backend listening");
});
