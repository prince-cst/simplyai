import type { Request, Response } from "express";
import {
  ActivateConnectionBodySchema,
  AddDatabaseBodySchema,
  ConnectBodySchema,
  DisconnectBodySchema,
  SampleBodySchema,
  SelectDatabaseBodySchema
} from "../schemas/queryPlan.js";
import { mongoConnectionManager } from "../services/mongodb/MongoConnectionManager.js";
import { sampleCollection } from "../services/mongodb/MongoIntrospectionService.js";
import { toCompactSchema } from "../services/mongodb/SchemaInferenceService.js";
import { looksLikeMysql } from "../services/sql/mysqlUri.js";
import { looksLikeMssql } from "../services/sql/mssqlUri.js";
import { sqlConnectionManager } from "../services/sql/SqlConnectionManager.js";
import { mssqlConnectionManager } from "../services/sql/MssqlConnectionManager.js";
import { sampleSessionSql } from "../services/sql/sqlSession.js";
import { isSqlEngine, sqlProductLabel } from "../services/sql/sqlEngine.js";
import { refreshSchema } from "../services/schemaRefresh.js";
import { getOrCreateSession } from "../services/session/SessionStore.js";
import { AppError } from "../utils/errors.js";

async function withSchema(sessionId: string, status: Awaited<ReturnType<typeof mongoConnectionManager.statusWithDetails>>) {
  if (status.connected && !status.needsDatabaseSelection) {
    const session = getOrCreateSession(sessionId);
    const schema = session.schema ?? (await refreshSchema(sessionId));
    return {
      ...status,
      schemaSummary: schema.summary,
      introspectedAt: schema.introspectedAt
    };
  }
  return status;
}

export async function connectMongo(req: Request, res: Response): Promise<void> {
  const body = ConnectBodySchema.parse(req.body);
  const uri = body.connectionString ?? "";
  const mssql = body.engine === "mssql" || looksLikeMssql(uri);
  const mysql = body.engine === "mysql" || looksLikeMysql(uri);
  const status = mssql
    ? await mongoConnectionManager.connectMssql(req.sessionId, {
        connectionString: body.connectionString,
        host: body.host,
        port: body.port,
        username: body.username,
        password: body.password,
        databaseName: body.databaseName,
        name: body.name
      })
    : mysql
      ? await mongoConnectionManager.connectMysql(req.sessionId, {
          connectionString: body.connectionString,
          host: body.host,
          port: body.port,
          username: body.username,
          password: body.password,
          databaseName: body.databaseName,
          name: body.name,
          ssl: body.ssl
        })
      : await mongoConnectionManager.connect(req.sessionId, body.connectionString ?? "", body.databaseName, body.name);
  res.json(await withSchema(req.sessionId, status));
}

export async function disconnectMongo(req: Request, res: Response): Promise<void> {
  const body = DisconnectBodySchema.parse(req.body ?? {});
  const status = await mongoConnectionManager.disconnect(req.sessionId, body.connectionId, body.forget);
  res.json(status);
}

export async function activateMongo(req: Request, res: Response): Promise<void> {
  const body = ActivateConnectionBodySchema.parse(req.body);
  const status = await mongoConnectionManager.activate(req.sessionId, body.connectionId);
  res.json(await withSchema(req.sessionId, status));
}

export async function addMongoDatabase(req: Request, res: Response): Promise<void> {
  const body = AddDatabaseBodySchema.parse(req.body);
  const status = await mongoConnectionManager.addDatabaseFromActive(req.sessionId, body.databaseName, body.name);
  res.json(await withSchema(req.sessionId, status));
}

export async function listSavedConnections(req: Request, res: Response): Promise<void> {
  await mongoConnectionManager.ensureLive(req.sessionId);
  res.json({
    connections: mongoConnectionManager.publicConnections(),
    activeConnectionId: getOrCreateSession(req.sessionId).activeConnectionId,
    ...mongoConnectionManager.getStatus(req.sessionId)
  });
}

export async function mongoStatus(req: Request, res: Response): Promise<void> {
  await mongoConnectionManager.ensureLive(req.sessionId);
  const session = getOrCreateSession(req.sessionId);
  let status = await mongoConnectionManager.statusWithDetails(req.sessionId);
  if (status.connected && !status.needsDatabaseSelection && !session.schema) {
    try {
      await refreshSchema(req.sessionId);
      status = await mongoConnectionManager.statusWithDetails(req.sessionId);
    } catch {
      // schema restore is best-effort on reconnect
    }
  }
  res.json({
    ...status,
    schemaSummary: getOrCreateSession(req.sessionId).schema?.summary,
    introspectedAt: getOrCreateSession(req.sessionId).schemaRefreshedAt,
    demoMode: !status.connected
  });
}

export async function listMongoDatabases(req: Request, res: Response): Promise<void> {
  await mongoConnectionManager.ensureLive(req.sessionId);
  const includeSystem = req.query.includeSystem === "true";
  const databases = await mongoConnectionManager.listDatabases(req.sessionId, includeSystem);
  res.json({ databases });
}

export async function selectMongoDatabase(req: Request, res: Response): Promise<void> {
  const body = SelectDatabaseBodySchema.parse(req.body);
  const status = await mongoConnectionManager.selectDatabase(req.sessionId, body.databaseName);
  res.json(await withSchema(req.sessionId, status));
}

export async function listMongoCollections(req: Request, res: Response): Promise<void> {
  await mongoConnectionManager.ensureLive(req.sessionId);
  const session = getOrCreateSession(req.sessionId);
  if (!session.schema) {
    const schema = await refreshSchema(req.sessionId);
    res.json({
      database: schema.database,
      collections: schema.collections.map((c) => ({
        name: c.name,
        estimatedCount: c.estimatedCount,
        fieldCount: c.fields.length
      }))
    });
    return;
  }
  res.json({
    database: session.schema.database,
    collections: session.schema.collections.map((c) => ({
      name: c.name,
      estimatedCount: c.estimatedCount,
      fieldCount: c.fields.length
    }))
  });
}

export function getMongoSchema(req: Request, res: Response): void {
  const session = getOrCreateSession(req.sessionId);
  if (!session.schema) {
    throw new AppError(404, "No schema", "No schema has been introspected yet.", ["Connect and refresh schema"], "NO_SCHEMA");
  }
  const compact = req.query.compact === "true";
  res.json({
    introspectedAt: session.schemaRefreshedAt,
    schema: compact ? toCompactSchema(session.schema) : session.schema
  });
}

export async function refreshMongoSchema(req: Request, res: Response): Promise<void> {
  await mongoConnectionManager.ensureLive(req.sessionId);
  const schema = await refreshSchema(req.sessionId);
  res.json({
    introspectedAt: schema.introspectedAt,
    summary: schema.summary,
    schema
  });
}

export function getCollectionDetails(req: Request, res: Response): void {
  const session = getOrCreateSession(req.sessionId);
  const name = req.params.name;
  if (!session.schema) {
    throw new AppError(404, "No schema", "No schema has been introspected yet.", [], "NO_SCHEMA");
  }
  const collection = session.schema.collections.find((c) => c.name === name);
  if (!collection) {
    throw new AppError(404, "Unknown collection", `Collection '${name}' was not found in the current schema.`, [], "NO_COLLECTION");
  }
  res.json({ collection, database: session.schema.database });
}

export async function sampleMongoCollection(req: Request, res: Response): Promise<void> {
  const limitRaw = req.query.limit;
  const body = SampleBodySchema.parse({
    collection: req.params.name,
    limit: typeof limitRaw === "string" ? Number.parseInt(limitRaw, 10) : 10
  });
  await mongoConnectionManager.ensureLive(req.sessionId);
  const session = getOrCreateSession(req.sessionId);
  if (!session.schema?.collections.some((c) => c.name === body.collection)) {
    throw new AppError(404, "Unknown collection", "Unknown collection.", [], "NO_COLLECTION");
  }
  if (isSqlEngine(session.engine) && session.activeConnectionId) {
    const documents = await sampleSessionSql(session, body.collection, body.limit ?? 10);
    res.json({ collection: body.collection, documents });
    return;
  }
  const db = mongoConnectionManager.getDb(req.sessionId);
  const documents = await sampleCollection(db, body.collection, body.limit ?? 10);
  res.json({ collection: body.collection, documents });
}

export async function testMongoConnection(req: Request, res: Response): Promise<void> {
  await mongoConnectionManager.ensureLive(req.sessionId);
  const status = mongoConnectionManager.getStatus(req.sessionId);
  const session = getOrCreateSession(req.sessionId);
  if (!status.connected) {
    res.json({
      ok: false,
      name: sqlProductLabel(status.engine) + " connection",
      message: "Not connected. Demo mode available. Run: npm run seed:test"
    });
    return;
  }
  if (session.engine === "mssql" && session.activeConnectionId) {
    const pool = mssqlConnectionManager.getPool(session.activeConnectionId);
    await pool.request().query("SELECT 1");
    res.json({
      ok: true,
      name: "SQL Server connection",
      message: "SQL Server connection successful",
      details: {
        database: status.database,
        tablesDiscovered: session.schema?.collections.length ?? 0
      }
    });
    return;
  }
  if (session.engine === "mysql" && session.activeConnectionId) {
    const pool = sqlConnectionManager.getPool(session.activeConnectionId);
    await pool.query("SELECT 1");
    res.json({
      ok: true,
      name: "MySQL connection",
      message: "MySQL connection successful",
      details: {
        database: status.database,
        tablesDiscovered: session.schema?.collections.length ?? 0
      }
    });
    return;
  }
  const db = mongoConnectionManager.getDb(req.sessionId);
  const names = await db.listCollections({}, { nameOnly: true }).toArray();
  let sampleOk = false;
  let sampleError: string | undefined;
  if (names[0]) {
    try {
      await db.collection(names[0].name).find({}).limit(1).maxTimeMS(5000).toArray();
      sampleOk = true;
    } catch (error) {
      sampleError = error instanceof Error ? error.message : "sample failed";
    }
  }
  res.json({
    ok: true,
    name: "MongoDB connection",
    message: "MongoDB connection successful",
    details: {
      database: status.database,
      collectionsDiscovered: names.length,
      sampleQuery: sampleOk ? "ok" : sampleError ?? "no collections"
    }
  });
}
