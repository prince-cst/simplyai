import mysql from "mysql2/promise";
import type { Pool } from "mysql2/promise";
import type { DatabaseSchema } from "../../types/index.js";
import type { SavedConnection } from "../../config/appStore.js";
import { AppError } from "../../utils/errors.js";
import { logger } from "../../utils/logger.js";
import { parseMysqlUri } from "./mysqlUri.js";
import { introspectMysqlDatabase, listMysqlDatabases } from "./SqlIntrospectionService.js";

export interface SqlLiveConnection {
  id: string;
  pool: Pool;
  uri: string;
  dbName?: string;
  schema?: DatabaseSchema;
  schemaRefreshedAt?: string;
  lastPing: number;
}

function sqlConnectError(cause?: unknown): AppError {
  const detail = cause instanceof Error ? cause.message : "Unknown error";
  return new AppError(
    400,
    `MySQL connection failed: ${detail}`,
    "Unable to connect to MySQL.",
    ["host / port", "username / password", "SSL (sslMode=preferred)", "database name", "firewall / IP allowlist"],
    "SQL_CONNECT"
  );
}

export class SqlConnectionManager {
  private readonly live = new Map<string, SqlLiveConnection>();

  async open(saved: SavedConnection): Promise<SqlLiveConnection> {
    const existing = this.live.get(saved.id);
    if (existing) {
      const ok = await this.ping(existing);
      if (ok) return existing;
      await existing.pool.end().catch(() => undefined);
      this.live.delete(saved.id);
    }
    const target = parseMysqlUri(saved.uri);
    const database = saved.databaseName || target.database;
    const base = {
      host: target.host,
      port: target.port,
      user: target.user,
      password: target.password,
      database,
      connectTimeout: 8000,
      waitForConnections: true,
      connectionLimit: 5
    };
    const trySsl = target.ssl !== false;
    let pool = mysql.createPool(
      trySsl ? { ...base, ssl: { rejectUnauthorized: false } } : base
    );
    try {
      await pool.query("SELECT 1");
    } catch (first) {
      await pool.end().catch(() => undefined);
      if (!trySsl) throw sqlConnectError(first);
      pool = mysql.createPool(base);
      try {
        await pool.query("SELECT 1");
      } catch (second) {
        await pool.end().catch(() => undefined);
        throw sqlConnectError(second);
      }
    }
    const live: SqlLiveConnection = {
      id: saved.id,
      pool,
      uri: saved.uri,
      dbName: database,
      lastPing: Date.now()
    };
    this.live.set(saved.id, live);
    logger.info({ operation: "sql-connect", collection: database }, "MySQL connected");
    return live;
  }

  async close(id: string): Promise<void> {
    const live = this.live.get(id);
    if (!live) return;
    await live.pool.end().catch(() => undefined);
    this.live.delete(id);
  }

  isOpen(id: string): boolean {
    return this.live.has(id);
  }

  isReady(id: string): boolean {
    const live = this.live.get(id);
    return Boolean(live?.dbName);
  }

  getLive(id: string): SqlLiveConnection | undefined {
    return this.live.get(id);
  }

  getPool(id: string): Pool {
    const live = this.live.get(id);
    if (!live) {
      throw new AppError(400, "Not connected", "Not connected to MySQL.", ["Connect a MySQL database first"], "NOT_CONNECTED");
    }
    if (!live.dbName) {
      throw new AppError(400, "No database selected", "Select a MySQL database to continue.", [], "NO_DATABASE");
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
    return listMysqlDatabases(live.pool);
  }

  async introspect(id: string): Promise<DatabaseSchema> {
    const live = this.live.get(id);
    if (!live?.dbName) {
      throw new AppError(400, "No database selected", "Select a MySQL database first.", [], "NO_DATABASE");
    }
    const schema = await introspectMysqlDatabase(live.pool, live.dbName);
    this.cacheSchema(id, schema, schema.introspectedAt);
    return schema;
  }

  private async ping(live: SqlLiveConnection): Promise<boolean> {
    if (Date.now() - live.lastPing < 8000) return true;
    try {
      await live.pool.query("SELECT 1");
      live.lastPing = Date.now();
      return true;
    } catch {
      return false;
    }
  }
}

export const sqlConnectionManager = new SqlConnectionManager();
