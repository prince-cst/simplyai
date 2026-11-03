import { v4 as uuid } from "uuid";
import {
  getAppStore,
  setSavedConnections,
  type SavedConnection
} from "../../config/appStore.js";
import { AppError } from "../../utils/errors.js";
import { logger } from "../../utils/logger.js";
import type { DatabaseSchema } from "../../types/index.js";
import { getOrCreateSession } from "../session/SessionStore.js";
import { apiBaseUrl, exchangeAuthorizationCode, refreshAccessToken } from "./oauth.js";
import { buildQuickBooksSchema } from "./schema.js";
import type { QuickBooksTokens } from "./types.js";

export interface QboLiveConnection {
  id: string;
  realmId: string;
  companyName: string;
  tokens: QuickBooksTokens;
  schema?: DatabaseSchema;
  schemaRefreshedAt?: string;
  lastPing: number;
}

function tokensFromSaved(saved: SavedConnection): QuickBooksTokens | undefined {
  if (
    !saved.qbAccessToken ||
    !saved.qbRefreshToken ||
    !saved.qbRealmId ||
    !saved.qbTokenExpiresAt
  ) {
    return undefined;
  }
  return {
    accessToken: saved.qbAccessToken,
    refreshToken: saved.qbRefreshToken,
    expiresAt: Date.parse(saved.qbTokenExpiresAt),
    refreshExpiresAt: saved.qbRefreshTokenExpiresAt
      ? Date.parse(saved.qbRefreshTokenExpiresAt)
      : undefined,
    realmId: saved.qbRealmId,
    companyName: saved.databaseName,
    tokenType: saved.qbTokenType
  };
}

function applyTokensToSaved(saved: SavedConnection, tokens: QuickBooksTokens, companyName?: string): void {
  saved.qbAccessToken = tokens.accessToken;
  saved.qbRefreshToken = tokens.refreshToken;
  saved.qbTokenExpiresAt = new Date(tokens.expiresAt).toISOString();
  saved.qbRefreshTokenExpiresAt = tokens.refreshExpiresAt
    ? new Date(tokens.refreshExpiresAt).toISOString()
    : undefined;
  saved.qbRealmId = tokens.realmId;
  saved.qbTokenType = tokens.tokenType;
  if (companyName) {
    saved.databaseName = companyName;
    saved.name = companyName;
  }
}

class QuickBooksConnectionManager {
  private readonly live = new Map<string, QboLiveConnection>();

  isReady(connectionId: string): boolean {
    return this.live.has(connectionId);
  }

  isOpen(connectionId: string): boolean {
    return this.live.has(connectionId);
  }

  getLive(connectionId: string): QboLiveConnection | undefined {
    return this.live.get(connectionId);
  }

  cacheSchema(connectionId: string, schema: DatabaseSchema, introspectedAt: string): void {
    const live = this.live.get(connectionId);
    if (!live) return;
    live.schema = schema;
    live.schemaRefreshedAt = introspectedAt;
  }

  async open(saved: SavedConnection): Promise<QboLiveConnection> {
    if (saved.engine !== "quickbooks") {
      throw new AppError(400, "Not QuickBooks", "Connection is not a QuickBooks company.", [], "QB_ENGINE");
    }
    const tokens = tokensFromSaved(saved);
    if (!tokens) {
      throw new AppError(
        400,
        "QuickBooks reconnect required",
        "Saved QuickBooks tokens are missing. Connect QuickBooks again.",
        [],
        "QB_NO_TOKENS"
      );
    }
    const existing = this.live.get(saved.id);
    if (existing && Date.now() - existing.lastPing < 30_000) {
      return existing;
    }
    const fresh = await this.ensureFreshTokens(saved.id, tokens);
    const companyName = fresh.companyName || saved.databaseName || `QB ${fresh.realmId}`;
    const live: QboLiveConnection = {
      id: saved.id,
      realmId: fresh.realmId,
      companyName,
      tokens: fresh,
      schema: existing?.schema,
      schemaRefreshedAt: existing?.schemaRefreshedAt,
      lastPing: Date.now()
    };
    this.live.set(saved.id, live);
    return live;
  }

  async connectFromCallback(sessionId: string, redirectUrl: string): Promise<{
    connectionId: string;
    companyName: string;
    realmId: string;
  }> {
    const { tokens, realmId } = await exchangeAuthorizationCode(redirectUrl);
    let companyName = `QuickBooks ${realmId}`;
    try {
      const info = await this.fetchCompanyInfo(tokens);
      const company = (info as { CompanyInfo?: { CompanyName?: string } })?.CompanyInfo;
      if (company?.CompanyName) companyName = company.CompanyName;
    } catch (error) {
      logger.warn(
        { errorType: "QB_COMPANY_INFO", message: error instanceof Error ? error.message : "unknown" },
        "Could not load company name; using realm id"
      );
    }

    const store = getAppStore();
    const list = [...store.connections];
    const existing = list.find((c) => c.engine === "quickbooks" && c.qbRealmId === realmId);
    const now = new Date().toISOString();
    let saved: SavedConnection;
    if (existing) {
      applyTokensToSaved(existing, { ...tokens, companyName }, companyName);
      existing.uri = `quickbooks://${realmId}`;
      existing.engine = "quickbooks";
      existing.serverLabel = "QuickBooks Online";
      existing.lastUsedAt = now;
      existing.lastError = undefined;
      saved = existing;
    } else {
      saved = {
        id: uuid(),
        name: companyName,
        uri: `quickbooks://${realmId}`,
        engine: "quickbooks",
        databaseName: companyName,
        serverLabel: "QuickBooks Online",
        createdAt: now,
        lastUsedAt: now
      };
      applyTokensToSaved(saved, { ...tokens, companyName }, companyName);
      list.push(saved);
    }
    setSavedConnections(list, saved.id);

    const live = await this.open(saved);
    const schema = buildQuickBooksSchema(companyName);
    live.schema = schema;
    live.schemaRefreshedAt = schema.introspectedAt;

    const session = getOrCreateSession(sessionId);
    session.activeConnectionId = saved.id;
    session.engine = "quickbooks";
    session.databaseName = companyName;
    session.serverLabel = "QuickBooks Online";
    session.mongoUri = saved.uri;
    session.schema = schema;
    session.schemaRefreshedAt = schema.introspectedAt;
    session.pendingQuery = undefined;

    return { connectionId: saved.id, companyName, realmId };
  }

  async ensureFreshTokens(connectionId: string, tokens: QuickBooksTokens): Promise<QuickBooksTokens> {
    if (tokens.expiresAt > Date.now() + 30_000) {
      return tokens;
    }
    const refreshed = await refreshAccessToken(tokens);
    const store = getAppStore();
    const list = [...store.connections];
    const row = list.find((c) => c.id === connectionId);
    if (row) {
      applyTokensToSaved(row, refreshed);
      row.lastUsedAt = new Date().toISOString();
      row.lastError = undefined;
      setSavedConnections(list, store.activeConnectionId);
    }
    const live = this.live.get(connectionId);
    if (live) live.tokens = refreshed;
    return refreshed;
  }

  async apiGet(connectionId: string, path: string): Promise<unknown> {
    const live = this.live.get(connectionId) ?? (await this.openFromStore(connectionId));
    const tokens = await this.ensureFreshTokens(connectionId, live.tokens);
    live.tokens = tokens;
    live.lastPing = Date.now();
    const url = `${apiBaseUrl()}${path}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        Accept: "application/json"
      }
    });
    const text = await response.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {
      /* keep text */
    }
    if (!response.ok) {
      const message =
        typeof json === "object" && json && "Fault" in json
          ? JSON.stringify((json as { Fault: unknown }).Fault)
          : text.slice(0, 500);
      throw new AppError(response.status, "QuickBooks API error", message, [], "QB_API");
    }
    return json;
  }

  private async openFromStore(connectionId: string): Promise<QboLiveConnection> {
    const saved = getAppStore().connections.find((c) => c.id === connectionId);
    if (!saved) {
      throw new AppError(404, "Unknown connection", "QuickBooks connection not found.", [], "NO_CONNECTION");
    }
    return this.open(saved);
  }

  private async fetchCompanyInfo(tokens: QuickBooksTokens): Promise<unknown> {
    const url = `${apiBaseUrl()}/v3/company/${tokens.realmId}/companyinfo/${tokens.realmId}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        Accept: "application/json"
      }
    });
    if (!response.ok) {
      throw new Error(`companyinfo ${response.status}`);
    }
    return response.json();
  }

  close(connectionId: string): void {
    this.live.delete(connectionId);
  }
}

export const quickBooksConnectionManager = new QuickBooksConnectionManager();
