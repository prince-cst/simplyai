import sql, { type ConnectionPool } from "mssql";
import type { DatabaseSchema } from "../../types/index.js";
import type { SavedConnection } from "../../config/appStore.js";
import { AppError } from "../../utils/errors.js";
import { logger } from "../../utils/logger.js";
import { parseMssqlUri } from "./mssqlUri.js";
import { introspectMssqlDatabase, listMssqlDatabases } from "./MssqlIntrospectionService.js";

export interface MssqlLiveConnection {
  id: string;
  pool: ConnectionPool;
  uri: string;
  dbName?: string;
  schema?: DatabaseSchema;
  schemaRefreshedAt?: string;
  lastPing: number;
}

function mssqlConnectError(cause?: unknown): AppError {
  const detail = cause instanceof Error ? cause.message : "Unknown error";
  return new AppError(
    400,
    `SQL Server connection failed: ${detail}`,
    "Unable to connect to SQL Server.",
    [
      "Data Source / host",
      "User ID and Password (not a masked ●●● password)",
      "Initial Catalog (database name)",
      "Encrypt=True for Azure SQL (*.database.windows.net)",
      "Azure SQL firewall must allow this computer's public IP"
    ],
    "SQL_CONNECT"
  );
}

export class MssqlConnectionManager {
  private readonly live = new Map<string, MssqlLiveConnection>();

  async open(saved: SavedConnection): Promise<MssqlLiveConnection> {
    const existing = this.live.get(saved.id);
    if (existing) {
      const ok = await this.ping(existing);
      if (ok) return existing;
      await existing.pool.close().catch(() => undefined);
      this.live.delete(saved.id);
    }
    const target = parseMssqlUri(saved.uri);
    const database = saved.databaseName || target.database;
    const pool = new sql.ConnectionPool({
      user: target.user,
      password: target.password,
      server: target.host,
      port: target.port,
      ...(database ? { database } : {}),
      connectionTimeout: 15000,
      requestTimeout: 30000,
      pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
      options: {
        encrypt: target.encrypt,
        trustServerCertificate: target.trustServerCertificate,
        enableArithAbort: true,
        ...(target.instance ? { instanceName: target.instance } : {})
      }
    });
    try {
      await pool.connect();
      await pool.request().query("SELECT 1");
    } catch (error) {
      await pool.close().catch(() => undefined);
      throw mssqlConnectError(error);
    }
    const live: MssqlLiveConnection = {
      id: saved.id,
      pool,
      uri: saved.uri,
      dbName: database,
      lastPing: Date.now()
    };
    this.live.set(saved.id, live);
    logger.info({ operation: "mssql-connect", collection: database }, "SQL Server connected");
    return live;
  }

  async close(id: string): Promise<void> {
    const live = this.live.get(id);
    if (!live) return;
    await live.pool.close().catch(() => undefined);
    this.live.delete(id);
  }

  isOpen(id: string): boolean {
    return this.live.has(id);
  }

  isReady(id: string): boolean {
    const live = this.live.get(id);
    return Boolean(live?.dbName);
  }

  getLive(id: string): MssqlLiveConnection | undefined {
    return this.live.get(id);
  }

  getPool(id: string): ConnectionPool {
    const live = this.live.get(id);
    if (!live) {
      throw new AppError(
        400,
        "Not connected",
        "Not connected to SQL Server.",
        ["Connect a SQL Server database first"],
        "NOT_CONNECTED"
      );
    }
    if (!live.dbName) {
      throw new AppError(400, "No database selected", "Select a SQL Server database to continue.", [], "NO_DATABASE");
    }
    return live.pool;
  }

  cacheSchema(id: string, schema: DatabaseSchema, introspectedAt: string): void {
    const live = this.live.get(id);
    if (!live) return;
    live.schema = schema;
    live.schemaRefreshedAt = introspectedAt;
  }

  async listDatabases(id: string): Promise<string[]> {
    const live = this.live.get(id);
    if (!live) return [];
    return listMssqlDatabases(live.pool);
  }

  async introspect(id: string): Promise<DatabaseSchema> {
    const live = this.live.get(id);
    if (!live?.dbName) {
      throw new AppError(400, "No database selected", "Select a SQL Server database first.", [], "NO_DATABASE");
    }
    const schema = await introspectMssqlDatabase(live.pool, live.dbName);
    this.cacheSchema(id, schema, schema.introspectedAt);
    return schema;
  }

  private async ping(live: MssqlLiveConnection): Promise<boolean> {
    if (Date.now() - live.lastPing < 8000) return true;
    try {
      await live.pool.request().query("SELECT 1");
      live.lastPing = Date.now();
      return true;
    } catch {
      return false;
    }
  }
}

export const mssqlConnectionManager = new MssqlConnectionManager();
