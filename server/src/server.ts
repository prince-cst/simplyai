import { createApp } from "./app.js";
import { loadAppStore } from "./config/appStore.js";
import { env } from "./config/env.js";
import { hydrateRuntimeSettingsFromStore } from "./config/runtimeSettings.js";
import { mongoConnectionManager } from "./services/mongodb/MongoConnectionManager.js";
import { triggerScheduler } from "./services/triggers/TriggerScheduler.js";
import { logger } from "./utils/logger.js";

loadAppStore();
hydrateRuntimeSettingsFromStore();

const app = createApp();

app.listen(env.port, () => {
  logger.info(
    { port: env.port, provider: env.defaultAiProvider },
    `Universal MongoDB AI Assistant API listening on http://localhost:${env.port}`
  );
  void mongoConnectionManager.restoreActiveFromStore().then(() => {
    logger.info("Saved databases and settings load from this project's local store.");
    triggerScheduler.start();
  });
});
