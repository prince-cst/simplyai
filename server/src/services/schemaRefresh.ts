import { getRuntimeSettings } from "../config/runtimeSettings.js";
import { mongoConnectionManager } from "./mongodb/MongoConnectionManager.js";
import { introspectDatabase } from "./mongodb/MongoIntrospectionService.js";
import { buildDatabaseSchema } from "./mongodb/SchemaInferenceService.js";
import { sqlConnectionManager } from "./sql/SqlConnectionManager.js";
import { mssqlConnectionManager } from "./sql/MssqlConnectionManager.js";
import { isSqlEngine, isQuickBooksEngine, isOutlookEngine } from "./sql/sqlEngine.js";
import { getOrCreateSession } from "./session/SessionStore.js";
import { AppError } from "../utils/errors.js";
import { buildQuickBooksSchema } from "./quickbooks/schema.js";
import { quickBooksConnectionManager } from "./quickbooks/QuickBooksConnectionManager.js";
import { buildOutlookSchema } from "./outlook/schema.js";
import { outlookConnectionManager } from "./outlook/OutlookConnectionManager.js";

export async function refreshSchema(sessionId: string) {
  if (!mongoConnectionManager.isConnected(sessionId)) {
    throw new AppError(
      400,
      "Not connected",
      "Not connected to a database.",
      ["Connect with a MongoDB, MySQL, SQL Server, QuickBooks, or Outlook connection first", "Demo mode available: npm run seed:test"],
      "NOT_CONNECTED"
    );
  }
  const session = getOrCreateSession(sessionId);
  if (isQuickBooksEngine(session.engine) && session.activeConnectionId) {
    const live = quickBooksConnectionManager.getLive(session.activeConnectionId);
    const companyName = live?.companyName || session.databaseName || "QuickBooks";
    const schema = buildQuickBooksSchema(companyName);
    session.schema = schema;
    session.schemaRefreshedAt = schema.introspectedAt;
    mongoConnectionManager.cacheSchema(sessionId, schema, schema.introspectedAt);
    return schema;
  }
  if (isOutlookEngine(session.engine) && session.activeConnectionId) {
    const live = outlookConnectionManager.getLive(session.activeConnectionId);
    const accountLabel = live?.accountName || session.databaseName || "Outlook";
    const schema = buildOutlookSchema(accountLabel);
    session.schema = schema;
    session.schemaRefreshedAt = schema.introspectedAt;
    mongoConnectionManager.cacheSchema(sessionId, schema, schema.introspectedAt);
    return schema;
  }
  if (isSqlEngine(session.engine) && session.activeConnectionId) {
    const schema =
      session.engine === "mssql"
        ? await mssqlConnectionManager.introspect(session.activeConnectionId)
        : await sqlConnectionManager.introspect(session.activeConnectionId);
    session.schema = schema;
    session.schemaRefreshedAt = schema.introspectedAt;
    mongoConnectionManager.cacheSchema(sessionId, schema, schema.introspectedAt);
    return schema;
  }
  const db = mongoConnectionManager.getDb(sessionId);
  const settings = getRuntimeSettings();
  const collections = await introspectDatabase(db, {
    sampleDocumentsPerCollection: settings.sampleDocumentsPerCollection
  });
  const schema = buildDatabaseSchema(db.databaseName, collections);
  session.schema = schema;
  session.schemaRefreshedAt = schema.introspectedAt;
  mongoConnectionManager.cacheSchema(sessionId, schema, schema.introspectedAt);
  return schema;
}
