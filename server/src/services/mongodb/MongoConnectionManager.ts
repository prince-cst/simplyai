import { MongoClient, type Db } from "mongodb";
import { v4 as uuid } from "uuid";
import {
  deleteWorkspace,
  emptyWorkspace,
  getAppStore,
  persistWorkspace,
  readWorkspace,
  setSavedConnections,
  type SavedConnection
} from "../../config/appStore.js";
import { AppError, mongoConnectError } from "../../utils/errors.js";
import { extractDatabaseName, isSystemDatabase, maskConnectionString } from "../../utils/mask.js";
import { logger } from "../../utils/logger.js";
import type { ConnectionStatus, DatabaseSchema, SavedConnectionPublic } from "../../types/index.js";
import { getOrCreateSession, type SessionState } from "../session/SessionStore.js";
import {
  connectionEngineOf,
  looksLikeMysql,
  parseMysqlTarget,
  parseMysqlUri,
  pickDefaultMysqlDatabase,
  toMysqlUri
} from "../sql/mysqlUri.js";
import { sqlConnectionManager } from "../sql/SqlConnectionManager.js";
import { mssqlConnectionManager } from "../sql/MssqlConnectionManager.js";
import { isOutlookEngine, isQuickBooksEngine, isSqlEngine, sqlProductLabel } from "../sql/sqlEngine.js";
import { quickBooksConnectionManager } from "../quickbooks/QuickBooksConnectionManager.js";
import { outlookConnectionManager } from "../outlook/OutlookConnectionManager.js";
import {
  looksLikeMssql,
  mssqlDisplayHost,
  parseMssqlTarget,
  parseMssqlUri,
  toMssqlUri
} from "../sql/mssqlUri.js";

export interface LiveConnection {
  id: string;
  client: MongoClient;
  uri: string;
  dbName?: string;
  serverLabel?: string;
  schema?: DatabaseSchema;
  schemaRefreshedAt?: string;
  lastPing: number;
}

export interface MongoConnectionManagerOptions {
  persist?: boolean;
}

function detectServerLabel(uri: string, hello: Record<string, unknown> | undefined): string {
  if (uri.includes("mongodb.net") || uri.startsWith("mongodb+srv://")) {
    return "MongoDB Atlas";
  }
  if (hello?.msg === "isdbgrid" || Array.isArray(hello?.hosts)) {
    return "MongoDB Cluster";
  }
  return "MongoDB Server";
}

export function defaultConnectionName(uri: string, databaseName?: string): string {
  if (databaseName) return databaseName;
  try {
    const normalized = uri.replace(/^mongodb\+srv:\/\//i, "https://").replace(/^mongodb:\/\//i, "http://");
    return new URL(normalized).host || "MongoDB";
  } catch {
    return "MongoDB";
  }
}

function mysqlDisplayName(host: string): string {
  return host || "MySQL";
}

function sqlLiveOf(connectionId: string, engine: "mysql" | "mssql") {
  return engine === "mssql" ? mssqlConnectionManager.getLive(connectionId) : sqlConnectionManager.getLive(connectionId);
}

export class MongoConnectionManager {
  private readonly persist: boolean;
  private readonly live = new Map<string, LiveConnection>();
  private memoryConnections: SavedConnection[] = [];
  private memoryActiveId?: string;

  constructor(options: MongoConnectionManagerOptions = {}) {
    this.persist = options.persist !== false;
  }

  private savedList(): SavedConnection[] {
    return this.persist ? getAppStore().connections : this.memoryConnections;
  }

  private writeSaved(connections: SavedConnection[], activeConnectionId?: string): void {
    if (this.persist) {
      setSavedConnections(connections, activeConnectionId);
      return;
    }
    this.memoryConnections = connections;
    this.memoryActiveId = activeConnectionId;
  }

  private activeSavedId(): string | undefined {
    return this.persist ? getAppStore().activeConnectionId : this.memoryActiveId;
  }

  persistSessionWorkspace(session: SessionState): void {
    if (!this.persist || !session.activeConnectionId) return;
    persistWorkspace(session.activeConnectionId, {
      chatTurns: session.chatTurns,
      queryHistory: session.queryHistory,
      threads: session.threads ?? [],
      activeThreadId: session.activeThreadId
    });
  }

  cacheSchema(sessionId: string, schema: DatabaseSchema, introspectedAt: string): void {
    const session = getOrCreateSession(sessionId);
    const id = session.activeConnectionId;
    if (!id) return;
    const live = this.live.get(id);
    if (live) {
      live.schema = schema;
      live.schemaRefreshedAt = introspectedAt;
    }
    sqlConnectionManager.cacheSchema(id, schema, introspectedAt);
    mssqlConnectionManager.cacheSchema(id, schema, introspectedAt);
    quickBooksConnectionManager.cacheSchema(id, schema, introspectedAt);
    outlookConnectionManager.cacheSchema(id, schema, introspectedAt);
  }

  async connect(
    sessionId: string,
    uri: string,
    databaseName?: string,
    name?: string
  ): Promise<ConnectionStatus> {
    return this.connectMongo(sessionId, uri, databaseName, name);
  }

  async connectMysql(
    sessionId: string,
    input: {
      connectionString?: string;
      host?: string;
      port?: number;
      username?: string;
      password?: string;
      databaseName?: string;
      name?: string;
      ssl?: boolean;
    }
  ): Promise<ConnectionStatus> {
    const target = parseMysqlTarget(input);
    const uri = toMysqlUri(target);
    const dbName = input.databaseName || target.database;
    const saved = this.upsertSaved({
      uri,
      databaseName: dbName,
      name: input.name?.trim() || dbName || mysqlDisplayName(target.host),
      engine: "mysql",
      serverLabel: "MySQL"
    });
    try {
      await this.openLive(saved);
      this.activateSaved(sessionId, saved.id);
      await this.ensureSqlDatabase(saved.id);
      this.activateSaved(sessionId, saved.id);
      return await this.statusWithDetails(sessionId);
    } catch (error) {
      this.markSavedError(saved.id, error);
      throw error instanceof AppError
        ? error
        : new AppError(400, String(error), "Unable to connect to MySQL.", [], "SQL_CONNECT");
    }
  }

  async connectMssql(
    sessionId: string,
    input: {
      connectionString?: string;
      host?: string;
      port?: number;
      username?: string;
      password?: string;
      databaseName?: string;
      name?: string;
    }
  ): Promise<ConnectionStatus> {
    const target = parseMssqlTarget(input);
    const uri = toMssqlUri(target);
    const dbName = input.databaseName || target.database;
    const saved = this.upsertSaved({
      uri,
      databaseName: dbName,
      name: input.name?.trim() || dbName || mssqlDisplayHost(target),
      engine: "mssql",
      serverLabel: "SQL Server"
    });
    try {
      await this.openLive(saved);
      this.activateSaved(sessionId, saved.id);
      await this.ensureSqlDatabase(saved.id);
      this.activateSaved(sessionId, saved.id);
      return await this.statusWithDetails(sessionId);
    } catch (error) {
      this.markSavedError(saved.id, error);
      throw error instanceof AppError
        ? error
        : new AppError(400, String(error), "Unable to connect to SQL Server.", [], "SQL_CONNECT");
    }
  }

  async connectMongo(
    sessionId: string,
    uri: string,
    databaseName?: string,
    name?: string
  ): Promise<ConnectionStatus> {
    const trimmed = uri.trim();
    if (!trimmed.startsWith("mongodb://") && !trimmed.startsWith("mongodb+srv://")) {
      throw new AppError(
        400,
        "Invalid MongoDB URI scheme",
        "Unable to connect to MongoDB.",
        ["connection string must start with mongodb:// or mongodb+srv://"],
        "MONGO_URI"
      );
    }

    const uriDb = extractDatabaseName(trimmed);
    const dbName = databaseName || uriDb;
    const saved = this.upsertSaved({
      uri: trimmed,
      databaseName: dbName,
      name: name?.trim() || defaultConnectionName(trimmed, dbName),
      engine: "mongodb"
    });

    try {
      await this.openLive(saved);
      this.activateSaved(sessionId, saved.id);
      logger.info({ operation: "connect", collection: dbName }, "MongoDB connected");
      return await this.statusWithDetails(sessionId);
    } catch (error) {
      this.markSavedError(saved.id, error);
      throw mongoConnectError(error);
    }
  }

  async selectDatabase(sessionId: string, databaseName: string): Promise<ConnectionStatus> {
    const session = getOrCreateSession(sessionId);
    const currentId = session.activeConnectionId ?? this.activeSavedId();
    const current = this.savedList().find((c) => c.id === currentId);
    if (!current) {
      throw new AppError(400, "Not connected", "Not connected to MongoDB.", ["Connect first"], "NOT_CONNECTED");
    }
    if (connectionEngineOf(current) === "mysql") {
      const target = parseMysqlUri(current.uri);
      const next = this.upsertSaved({
        id: current.id,
        uri: toMysqlUri({ ...target, database: databaseName }),
        databaseName,
        name: current.name,
        engine: "mysql",
        serverLabel: "MySQL"
      });
      await sqlConnectionManager.close(current.id);
      await this.openLive(next);
      this.activateSaved(sessionId, next.id);
      return this.statusWithDetails(sessionId);
    }
    if (connectionEngineOf(current) === "mssql") {
      const target = parseMssqlUri(current.uri);
      const next = this.upsertSaved({
        id: current.id,
        uri: toMssqlUri({ ...target, database: databaseName }),
        databaseName,
        name: current.name,
        engine: "mssql",
        serverLabel: "SQL Server"
      });
      await mssqlConnectionManager.close(current.id);
      await this.openLive(next);
      this.activateSaved(sessionId, next.id);
      return this.statusWithDetails(sessionId);
    }
    if (!current.databaseName) {
      const next = this.upsertSaved({
        ...current,
        id: current.id,
        databaseName,
        name: current.name === defaultConnectionName(current.uri) ? databaseName : current.name
      });
      await this.openLive(next);
      this.activateSaved(sessionId, next.id);
      return this.statusWithDetails(sessionId);
    }
    return this.connect(sessionId, current.uri, databaseName, databaseName);
  }

  async addDatabaseFromActive(sessionId: string, databaseName: string, name?: string): Promise<ConnectionStatus> {
    const session = getOrCreateSession(sessionId);
    const currentId = session.activeConnectionId ?? this.activeSavedId();
    const current = this.savedList().find((c) => c.id === currentId);
    if (!current) {
      throw new AppError(400, "Not connected", "Not connected to MongoDB.", ["Connect first"], "NOT_CONNECTED");
    }
    if (connectionEngineOf(current) === "mysql") {
      return this.connectMysql(sessionId, {
        connectionString: current.uri,
        databaseName,
        name: name || databaseName
      });
    }
    if (connectionEngineOf(current) === "mssql") {
      return this.connectMssql(sessionId, {
        connectionString: current.uri,
        databaseName,
        name: name || databaseName
      });
    }
    return this.connect(sessionId, current.uri, databaseName, name || databaseName);
  }

  async activate(sessionId: string, connectionId: string): Promise<ConnectionStatus> {
    const saved = this.savedList().find((c) => c.id === connectionId);
    if (!saved) {
      throw new AppError(404, "Unknown connection", "That saved database was not found.", [], "NO_CONNECTION");
    }
    try {
      await this.openLive(saved);
      await this.ensureSqlDatabase(saved.id);
      this.activateSaved(sessionId, saved.id);
      return this.statusWithDetails(sessionId);
    } catch (error) {
      this.markSavedError(saved.id, error);
      throw error instanceof AppError ? error : mongoConnectError(error);
    }
  }

  async disconnect(sessionId: string, connectionId?: string, forget = false): Promise<ConnectionStatus> {
    const session = getOrCreateSession(sessionId);
    const targetId = connectionId ?? session.activeConnectionId ?? this.activeSavedId();
    if (targetId) {
      if (session.activeConnectionId === targetId) {
        this.persistSessionWorkspace(session);
      }
      const live = this.live.get(targetId);
    if (live) {
      await live.client.close().catch(() => undefined);
      this.live.delete(targetId);
    }
    await sqlConnectionManager.close(targetId);
    await mssqlConnectionManager.close(targetId);
    quickBooksConnectionManager.close(targetId);
    outlookConnectionManager.close(targetId);
      let list = this.savedList();
      if (forget) {
        list = list.filter((c) => c.id !== targetId);
        if (this.persist) deleteWorkspace(targetId);
      }
      const stillActive = this.activeSavedId() === targetId;
      const nextId = stillActive ? list.find((c) => c.id !== targetId)?.id : this.activeSavedId();
      this.writeSaved(list, forget || stillActive ? nextId : this.activeSavedId());
    }

    const nextActive = this.activeSavedId();
    if (nextActive && nextActive !== targetId) {
      try {
        await this.openLive(this.savedList().find((c) => c.id === nextActive)!);
        this.activateSaved(sessionId, nextActive);
      } catch {
        this.clearSessionConnection(session);
      }
    } else {
      this.clearSessionConnection(session);
    }
    return this.statusWithDetails(sessionId);
  }

  async restoreActiveFromStore(): Promise<void> {
    const id = this.activeSavedId();
    if (!id) return;
    const saved = this.savedList().find((c) => c.id === id);
    if (!saved) return;
    try {
      await this.openLive(saved);
      await this.ensureSqlDatabase(saved.id);
    } catch (error) {
      this.markSavedError(saved.id, error);
    }
  }

  async ensureLive(sessionId: string): Promise<void> {
    const session = getOrCreateSession(sessionId);
    let id = session.activeConnectionId ?? this.activeSavedId();
    if (!id) {
      const first = this.savedList()[0];
      if (!first) return;
      id = first.id;
    }
    const saved = this.savedList().find((c) => c.id === id);
    if (!saved) return;
    try {
      if (connectionEngineOf(saved) === "quickbooks") {
        await quickBooksConnectionManager.open(saved);
        if (session.activeConnectionId !== saved.id) {
          this.activateSaved(sessionId, saved.id);
        } else {
          session.engine = "quickbooks";
          session.databaseName = saved.databaseName;
          session.mongoUri = saved.uri;
          this.applyRelationalSession(session, saved, false);
        }
        return;
      }
      if (connectionEngineOf(saved) === "outlook") {
        await outlookConnectionManager.open(saved);
        if (session.activeConnectionId !== saved.id) {
          this.activateSaved(sessionId, saved.id);
        } else {
          session.engine = "outlook";
          session.databaseName = saved.databaseName;
          session.mongoUri = saved.uri;
          this.applyRelationalSession(session, saved, false);
        }
        return;
      }
      await this.openLive(saved);
      await this.ensureSqlDatabase(saved.id);
      const latest = this.savedList().find((c) => c.id === saved.id) ?? saved;
      if (session.activeConnectionId !== latest.id) {
        this.activateSaved(sessionId, latest.id);
      } else {
        session.engine = connectionEngineOf(latest);
        session.databaseName = latest.databaseName;
        session.mongoUri = latest.uri;
        this.applyRelationalSession(session, latest, false);
      }
    } catch (error) {
      this.markSavedError(saved.id, error);
    }
  }

  private async ensureSqlDatabase(connectionId: string): Promise<void> {
    await this.ensureMysqlDatabase(connectionId);
    await this.ensureMssqlDatabase(connectionId);
  }

  private async ensureMysqlDatabase(connectionId: string): Promise<void> {
    const saved = this.savedList().find((c) => c.id === connectionId);
    if (!saved || connectionEngineOf(saved) !== "mysql") return;

    const live = sqlConnectionManager.getLive(connectionId);
    if (!live) return;

    if (saved.databaseName) {
      if (live.dbName) return;
      await sqlConnectionManager.close(connectionId);
      await this.openLive(saved);
      return;
    }

    const databases = await sqlConnectionManager.listDatabases(connectionId);
    const chosen = pickDefaultMysqlDatabase(saved.name, databases);
    if (!chosen) return;

    const target = parseMysqlUri(saved.uri);
    const next = this.upsertSaved({
      id: saved.id,
      uri: toMysqlUri({ ...target, database: chosen }),
      databaseName: chosen,
      name: saved.name,
      engine: "mysql",
      serverLabel: "MySQL"
    });
    await sqlConnectionManager.close(connectionId);
    await this.openLive(next);
  }

  private async ensureMssqlDatabase(connectionId: string): Promise<void> {
    const saved = this.savedList().find((c) => c.id === connectionId);
    if (!saved || connectionEngineOf(saved) !== "mssql") return;

    const live = mssqlConnectionManager.getLive(connectionId);
    if (!live) return;

    if (saved.databaseName) {
      if (live.dbName) return;
      await mssqlConnectionManager.close(connectionId);
      await this.openLive(saved);
      return;
    }

    let databases: string[] = [];
    try {
      databases = await mssqlConnectionManager.listDatabases(connectionId);
    } catch {
      return;
    }
    const chosen = pickDefaultMysqlDatabase(saved.name, databases);
    if (!chosen) return;

    const target = parseMssqlUri(saved.uri);
    const next = this.upsertSaved({
      id: saved.id,
      uri: toMssqlUri({ ...target, database: chosen }),
      databaseName: chosen,
      name: saved.name,
      engine: "mssql",
      serverLabel: "SQL Server"
    });
    await mssqlConnectionManager.close(connectionId);
    await this.openLive(next);
  }

  getClient(sessionId: string): MongoClient {
    return this.requireLive(sessionId).client;
  }

  getDb(sessionId: string): Db {
    const live = this.requireLive(sessionId);
    if (!live.dbName) {
      throw new AppError(
        400,
        "No database selected",
        "Select a database to continue.",
        ["The connection string did not include a database name"],
        "NO_DATABASE"
      );
    }
    return live.client.db(live.dbName);
  }

  /** Open (or reuse) a saved connection by id — used by trigger scheduler (no session). */
  async ensureLiveForConnection(connectionId: string): Promise<void> {
    const saved = this.savedList().find((c) => c.id === connectionId);
    if (!saved) {
      throw new AppError(404, "Connection not found", "Saved connection not found.", [], "NO_CONNECTION");
    }
    await this.openLive(saved);
    await this.ensureSqlDatabase(saved.id);
  }

  getDbForConnection(connectionId: string): Db {
    const live = this.live.get(connectionId);
    if (!live?.dbName) {
      throw new AppError(
        400,
        "No database selected",
        "MongoDB connection is not live or has no database selected.",
        [],
        "NO_DATABASE"
      );
    }
    return live.client.db(live.dbName);
  }

  getSaved(connectionId: string): SavedConnection | undefined {
    return this.savedList().find((c) => c.id === connectionId);
  }

  isConnected(sessionId: string): boolean {
    const session = getOrCreateSession(sessionId);
    const id = session.activeConnectionId ?? this.activeSavedId();
    const saved = id ? this.savedList().find((c) => c.id === id) : undefined;
    if (!id || !saved) return false;
    if (connectionEngineOf(saved) === "mysql") {
      return sqlConnectionManager.isReady(id);
    }
    if (connectionEngineOf(saved) === "mssql") {
      return mssqlConnectionManager.isReady(id);
    }
    if (connectionEngineOf(saved) === "quickbooks") {
      return quickBooksConnectionManager.isReady(id);
    }
    if (connectionEngineOf(saved) === "outlook") {
      return outlookConnectionManager.isReady(id);
    }
    return Boolean(this.live.has(id) && this.live.get(id)?.dbName);
  }

  getStatus(sessionId: string): ConnectionStatus {
    const session = getOrCreateSession(sessionId);
    const id = session.activeConnectionId ?? this.activeSavedId();
    const saved = id ? this.savedList().find((c) => c.id === id) : undefined;
    const connections = this.publicConnections();
    const engine = connectionEngineOf(saved);
    if (isQuickBooksEngine(engine) && id) {
      const qbLive = quickBooksConnectionManager.getLive(id);
      if (!qbLive) {
        return {
          connected: false,
          demoMode: connections.length === 0,
          engine,
          connections,
          activeConnectionId: id,
          connectionName: saved?.name,
          lastError: saved?.lastError
        };
      }
      return {
        connected: true,
        database: qbLive.companyName,
        server: "QuickBooks Online",
        engine,
        collectionCount: qbLive.schema?.summary.collectionCount ?? session.schema?.summary.collectionCount,
        maskedUri: `quickbooks://${qbLive.realmId}`,
        needsDatabaseSelection: false,
        demoMode: false,
        activeConnectionId: qbLive.id,
        connectionName: saved?.name,
        connections,
        lastError: saved?.lastError
      };
    }
    if (isOutlookEngine(engine) && id) {
      const msLive = outlookConnectionManager.getLive(id);
      if (!msLive) {
        return {
          connected: false,
          demoMode: connections.length === 0,
          engine,
          connections,
          activeConnectionId: id,
          connectionName: saved?.name,
          lastError: saved?.lastError
        };
      }
      return {
        connected: true,
        database: msLive.accountName,
        server: "Microsoft Outlook",
        engine,
        collectionCount: msLive.schema?.summary.collectionCount ?? session.schema?.summary.collectionCount,
        maskedUri: `outlook://${msLive.accountEmail}`,
        needsDatabaseSelection: false,
        demoMode: false,
        activeConnectionId: msLive.id,
        connectionName: saved?.name,
        connections,
        lastError: saved?.lastError
      };
    }
    if (isSqlEngine(engine) && id) {
      const sqlLive = sqlLiveOf(id, engine);
      if (!sqlLive) {
        return {
          connected: false,
          demoMode: connections.length === 0,
          engine,
          connections,
          activeConnectionId: id,
          connectionName: saved?.name,
          lastError: saved?.lastError
        };
      }
      return {
        connected: true,
        database: sqlLive.dbName,
        server: sqlProductLabel(engine),
        engine,
        collectionCount: sqlLive.schema?.summary.collectionCount ?? session.schema?.summary.collectionCount,
        maskedUri: maskConnectionString(sqlLive.uri),
        needsDatabaseSelection: !sqlLive.dbName,
        demoMode: false,
        activeConnectionId: sqlLive.id,
        connectionName: saved?.name,
        connections,
        lastError: saved?.lastError
      };
    }
    const live = id ? this.live.get(id) : undefined;
    if (!live) {
      return {
        connected: false,
        demoMode: connections.length === 0,
        engine: "mongodb",
        connections,
        activeConnectionId: id,
        connectionName: saved?.name,
        lastError: saved?.lastError
      };
    }
    return {
      connected: true,
      database: live.dbName,
      server: live.serverLabel ?? session.serverLabel,
      engine: "mongodb",
      collectionCount: live.schema?.summary.collectionCount ?? session.schema?.summary.collectionCount,
      maskedUri: maskConnectionString(live.uri),
      needsDatabaseSelection: !live.dbName,
      demoMode: false,
      activeConnectionId: live.id,
      connectionName: saved?.name,
      connections,
      lastError: saved?.lastError
    };
  }

  async statusWithDetails(sessionId: string): Promise<ConnectionStatus> {
    const status = this.getStatus(sessionId);
    if (status.connected) {
      try {
        status.databases = await this.listDatabases(sessionId);
      } catch {
        status.databases = [];
      }
    }
    return status;
  }

  async listDatabases(sessionId: string, includeSystem = false): Promise<string[]> {
    const session = getOrCreateSession(sessionId);
    const id = session.activeConnectionId ?? this.activeSavedId();
    const saved = id ? this.savedList().find((c) => c.id === id) : undefined;
    if (saved && connectionEngineOf(saved) === "mysql" && id) {
      return sqlConnectionManager.listDatabases(id);
    }
    if (saved && connectionEngineOf(saved) === "mssql" && id) {
      return mssqlConnectionManager.listDatabases(id);
    }
    if (saved && connectionEngineOf(saved) === "quickbooks") {
      return saved.databaseName ? [saved.databaseName] : [];
    }
    if (saved && connectionEngineOf(saved) === "outlook") {
      return saved.databaseName ? [saved.databaseName] : [];
    }
    const client = this.getClient(sessionId);
    const result = await client.db("admin").admin().listDatabases();
    return result.databases
      .map((d) => d.name)
      .filter((name) => includeSystem || !isSystemDatabase(name));
  }

  publicConnections(): SavedConnectionPublic[] {
    return this.savedList().map((c) => ({
      id: c.id,
      name: c.name,
      maskedUri: maskConnectionString(c.uri),
      databaseName: c.databaseName,
      server: c.serverLabel,
      engine: connectionEngineOf(c),
      connected:
        this.live.has(c.id) ||
        sqlConnectionManager.isOpen(c.id) ||
        mssqlConnectionManager.isOpen(c.id) ||
        quickBooksConnectionManager.isOpen(c.id) ||
        outlookConnectionManager.isOpen(c.id),
      lastUsedAt: c.lastUsedAt,
      lastError: c.lastError,
      needsDatabaseSelection:
        connectionEngineOf(c) === "quickbooks" || connectionEngineOf(c) === "outlook"
          ? false
          : !c.databaseName
    }));
  }

  private requireLive(sessionId: string): LiveConnection {
    const session = getOrCreateSession(sessionId);
    const id = session.activeConnectionId ?? this.activeSavedId();
    const live = id ? this.live.get(id) : undefined;
    if (!live) {
      throw new AppError(
        400,
        "Not connected",
        "Not connected to MongoDB.",
        ["Enter a connection string and click Connect", "Saved databases are stored in this project's local store"],
        "NOT_CONNECTED"
      );
    }
    return live;
  }

  private upsertSaved(input: {
    id?: string;
    uri: string;
    databaseName?: string;
    name: string;
    serverLabel?: string;
    engine?: "mongodb" | "mysql" | "mssql" | "quickbooks" | "outlook";
  }): SavedConnection {
    const list = [...this.savedList()];
    const existing =
      (input.id ? list.find((c) => c.id === input.id) : undefined) ??
      list.find((c) => c.uri === input.uri && (c.databaseName ?? "") === (input.databaseName ?? ""));
    const now = new Date().toISOString();
    if (existing) {
      existing.uri = input.uri;
      existing.databaseName = input.databaseName;
      existing.name = input.name || existing.name;
      if (input.serverLabel) existing.serverLabel = input.serverLabel;
      if (input.engine) existing.engine = input.engine;
      existing.lastUsedAt = now;
      existing.lastError = undefined;
      this.writeSaved(list, existing.id);
      return existing;
    }
    const created: SavedConnection = {
      id: uuid(),
      name: input.name,
      uri: input.uri,
      engine: input.engine ?? (looksLikeMssql(input.uri) ? "mssql" : looksLikeMysql(input.uri) ? "mysql" : "mongodb"),
      databaseName: input.databaseName,
      serverLabel: input.serverLabel,
      createdAt: now,
      lastUsedAt: now
    };
    list.push(created);
    this.writeSaved(list, created.id);
    return created;
  }

  private markSavedError(id: string, error: unknown): void {
    const list = [...this.savedList()];
    const item = list.find((c) => c.id === id);
    if (!item) return;
    item.lastError = error instanceof Error ? error.message.slice(0, 200) : "Connection failed";
    this.writeSaved(list, this.activeSavedId());
  }

  private async openLive(saved: SavedConnection): Promise<LiveConnection | undefined> {
    if (connectionEngineOf(saved) === "mysql") {
      await sqlConnectionManager.open(saved);
      const list = [...this.savedList()];
      const row = list.find((c) => c.id === saved.id);
      if (row) {
        row.lastError = undefined;
        row.lastUsedAt = new Date().toISOString();
        this.writeSaved(list, this.activeSavedId() ?? saved.id);
      }
      return undefined;
    }
    if (connectionEngineOf(saved) === "mssql") {
      await mssqlConnectionManager.open(saved);
      const list = [...this.savedList()];
      const row = list.find((c) => c.id === saved.id);
      if (row) {
        row.lastError = undefined;
        row.lastUsedAt = new Date().toISOString();
        this.writeSaved(list, this.activeSavedId() ?? saved.id);
      }
      return undefined;
    }
    if (connectionEngineOf(saved) === "quickbooks") {
      await quickBooksConnectionManager.open(saved);
      const list = [...this.savedList()];
      const row = list.find((c) => c.id === saved.id);
      if (row) {
        row.lastError = undefined;
        row.lastUsedAt = new Date().toISOString();
        this.writeSaved(list, this.activeSavedId() ?? saved.id);
      }
      return undefined;
    }
    if (connectionEngineOf(saved) === "outlook") {
      await outlookConnectionManager.open(saved);
      const list = [...this.savedList()];
      const row = list.find((c) => c.id === saved.id);
      if (row) {
        row.lastError = undefined;
        row.lastUsedAt = new Date().toISOString();
        this.writeSaved(list, this.activeSavedId() ?? saved.id);
      }
      return undefined;
    }
    const existing = this.live.get(saved.id);
    if (existing) {
      const ok = await this.ping(existing);
      if (ok) return existing;
      await existing.client.close().catch(() => undefined);
      this.live.delete(saved.id);
    }

    const client = new MongoClient(saved.uri, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
      heartbeatFrequencyMS: 10000
    });
    try {
      await client.connect();
      const hello = (await client.db("admin").command({ hello: 1 })) as Record<string, unknown>;
      const server = detectServerLabel(saved.uri, hello);
      const live: LiveConnection = {
        id: saved.id,
        client,
        uri: saved.uri,
        dbName: saved.databaseName,
        serverLabel: server,
        lastPing: Date.now()
      };
      this.live.set(saved.id, live);
      const list = [...this.savedList()];
      const row = list.find((c) => c.id === saved.id);
      if (row) {
        row.serverLabel = server;
        row.lastError = undefined;
        row.lastUsedAt = new Date().toISOString();
        this.writeSaved(list, this.activeSavedId() ?? saved.id);
      }
      return live;
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    }
  }

  private async ping(live: LiveConnection): Promise<boolean> {
    if (Date.now() - live.lastPing < 8000) return true;
    try {
      await live.client.db("admin").command({ ping: 1 });
      live.lastPing = Date.now();
      return true;
    } catch {
      return false;
    }
  }

  private applyRelationalSession(session: SessionState, saved: SavedConnection, replaceSchema: boolean): void {
    const engine = connectionEngineOf(saved);
    session.engine = engine;
    if (isQuickBooksEngine(engine)) {
      const qbLive = quickBooksConnectionManager.getLive(saved.id);
      session.serverLabel = "QuickBooks Online";
      session.schema = replaceSchema ? qbLive?.schema : qbLive?.schema ?? session.schema;
      session.schemaRefreshedAt = replaceSchema
        ? qbLive?.schemaRefreshedAt
        : qbLive?.schemaRefreshedAt ?? session.schemaRefreshedAt;
      return;
    }
    if (isOutlookEngine(engine)) {
      const msLive = outlookConnectionManager.getLive(saved.id);
      session.serverLabel = "Microsoft Outlook";
      session.schema = replaceSchema ? msLive?.schema : msLive?.schema ?? session.schema;
      session.schemaRefreshedAt = replaceSchema
        ? msLive?.schemaRefreshedAt
        : msLive?.schemaRefreshedAt ?? session.schemaRefreshedAt;
      return;
    }
    if (isSqlEngine(engine)) {
      const sqlLive = sqlLiveOf(saved.id, engine);
      session.serverLabel = sqlProductLabel(engine);
      session.schema = replaceSchema ? sqlLive?.schema : sqlLive?.schema ?? session.schema;
      session.schemaRefreshedAt = replaceSchema
        ? sqlLive?.schemaRefreshedAt
        : sqlLive?.schemaRefreshedAt ?? session.schemaRefreshedAt;
      return;
    }
    const live = this.live.get(saved.id);
    session.serverLabel = live?.serverLabel ?? saved.serverLabel;
    session.schema = replaceSchema ? live?.schema : live?.schema ?? session.schema;
    session.schemaRefreshedAt = replaceSchema
      ? live?.schemaRefreshedAt
      : live?.schemaRefreshedAt ?? session.schemaRefreshedAt;
  }

  private activateSaved(sessionId: string, connectionId: string): void {
    const session = getOrCreateSession(sessionId);
    const saved = this.savedList().find((c) => c.id === connectionId);
    if (!saved) return;
    if (session.activeConnectionId === connectionId) {
      this.writeSaved(this.savedList(), connectionId);
      session.databaseName = saved.databaseName;
      session.mongoUri = saved.uri;
      this.applyRelationalSession(session, saved, false);
      return;
    }
    if (session.activeConnectionId) {
      this.persistSessionWorkspace(session);
    }
    this.writeSaved(this.savedList(), connectionId);
    session.activeConnectionId = connectionId;
    this.attachLiveToSession(session, saved);
  }

  private attachLiveToSession(session: SessionState, saved: SavedConnection): void {
    const workspace = this.persist ? readWorkspace(saved.id) : emptyWorkspace();
    session.activeConnectionId = saved.id;
    session.mongoUri = saved.uri;
    session.databaseName = saved.databaseName;
    session.pendingQuery = undefined;
    session.chatTurns = workspace.chatTurns;
    session.queryHistory = workspace.queryHistory;
    session.threads = workspace.threads ?? [];
    session.activeThreadId = workspace.activeThreadId;
    this.applyRelationalSession(session, saved, true);
  }

  private clearSessionConnection(session: SessionState): void {
    session.activeConnectionId = undefined;
    session.schema = undefined;
    session.schemaRefreshedAt = undefined;
    session.chatTurns = [];
    session.queryHistory = [];
    session.threads = [];
    session.activeThreadId = undefined;
    session.pendingQuery = undefined;
    session.databaseName = undefined;
    session.serverLabel = undefined;
    session.mongoUri = undefined;
  }
}

export const mongoConnectionManager = new MongoConnectionManager();
