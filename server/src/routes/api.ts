import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { healthWithSession } from "../controllers/healthController.js";
import {
  connectMongo,
  disconnectMongo,
  activateMongo,
  addMongoDatabase,
  listSavedConnections,
  getCollectionDetails,
  getMongoSchema,
  listMongoCollections,
  listMongoDatabases,
  mongoStatus,
  refreshMongoSchema,
  sampleMongoCollection,
  selectMongoDatabase,
  testMongoConnection
} from "../controllers/mongoController.js";
import {
  getSettings,
  listAiModels,
  listProviders,
  testAi,
  updateSettings
} from "../controllers/aiController.js";
import {
  chat,
  clearHistory,
  deleteThread,
  executeQuery,
  getHistory,
  newChat,
  openThread,
  resumeChat,
  validateQuery
} from "../controllers/chatController.js";
import { runTestCenter } from "../controllers/testController.js";
import {
  quickBooksCallback,
  quickbooksStatus,
  startQuickBooksConnect
} from "../controllers/quickbooksController.js";
import {
  microsoftAuthCallback,
  outlookInbox,
  outlookStatus,
  startOutlookConnect
} from "../controllers/outlookController.js";
import {
  approve as approveTrigger,
  create as createTrigger,
  getOne as getTrigger,
  list as listTriggers,
  patch as patchTrigger,
  propose as proposeTrigger,
  remove as removeTrigger,
  testRun as testTrigger
} from "../controllers/triggerController.js";

export const apiRouter = Router();

apiRouter.get("/health", healthWithSession);

apiRouter.post("/mongodb/connect", asyncHandler(connectMongo));
apiRouter.post("/mongodb/disconnect", asyncHandler(disconnectMongo));
apiRouter.post("/mongodb/activate", asyncHandler(activateMongo));
apiRouter.post("/mongodb/databases/add", asyncHandler(addMongoDatabase));
apiRouter.get("/mongodb/connections", asyncHandler(listSavedConnections));
apiRouter.get("/mongodb/status", asyncHandler(mongoStatus));
apiRouter.get("/mongodb/databases", asyncHandler(listMongoDatabases));
apiRouter.post("/mongodb/select-database", asyncHandler(selectMongoDatabase));
apiRouter.get("/mongodb/collections", asyncHandler(listMongoCollections));
apiRouter.get("/mongodb/collections/:name", getCollectionDetails);
apiRouter.get("/mongodb/collections/:name/sample", asyncHandler(sampleMongoCollection));
apiRouter.get("/mongodb/schema", getMongoSchema);
apiRouter.post("/mongodb/refresh-schema", asyncHandler(refreshMongoSchema));
apiRouter.post("/mongodb/test", asyncHandler(testMongoConnection));

apiRouter.get("/quickbooks/status", quickbooksStatus);
apiRouter.get("/quickbooks/connect", startQuickBooksConnect);
apiRouter.get("/quickbooks/callback", asyncHandler(quickBooksCallback));

apiRouter.get("/outlook/status", outlookStatus);
apiRouter.get("/outlook/connect", startOutlookConnect);
apiRouter.get("/auth/microsoft/callback", asyncHandler(microsoftAuthCallback));
apiRouter.get("/outlook/inbox", asyncHandler(outlookInbox));

apiRouter.get("/ai/providers", listProviders);
apiRouter.post("/ai/test", asyncHandler(testAi));
apiRouter.get("/ai/models", asyncHandler(listAiModels));
apiRouter.get("/settings", getSettings);
apiRouter.put("/settings", updateSettings);

apiRouter.post("/chat", asyncHandler(chat));
apiRouter.post("/query/validate", validateQuery);
apiRouter.post("/query/execute", asyncHandler(executeQuery));

apiRouter.get("/history", getHistory);
apiRouter.post("/history/new", newChat);
apiRouter.post("/history/resume", resumeChat);
apiRouter.post("/history/threads/:id", openThread);
apiRouter.delete("/history/threads/:id", deleteThread);
apiRouter.delete("/history", clearHistory);

apiRouter.post("/tests/run", asyncHandler(runTestCenter));
apiRouter.get("/tests/run", asyncHandler(runTestCenter));

apiRouter.post("/triggers/propose", asyncHandler(proposeTrigger));
apiRouter.get("/triggers", listTriggers);
apiRouter.get("/triggers/:id", getTrigger);
apiRouter.post("/triggers", createTrigger);
apiRouter.patch("/triggers/:id", patchTrigger);
apiRouter.post("/triggers/:id/approve", approveTrigger);
apiRouter.post("/triggers/:id/test", asyncHandler(testTrigger));
apiRouter.delete("/triggers/:id", removeTrigger);
