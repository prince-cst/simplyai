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
import {
  exchangeAuthorizationCode,
  fetchGraphProfile,
  outlookAccountKey,
  refreshAccessToken
} from "./oauth.js";
import { buildOutlookSchema } from "./schema.js";
import type { MicrosoftTokens } from "./types.js";

export interface OutlookLiveConnection {
  id: string;
  accountEmail: string;
  accountName: string;
  tokens: MicrosoftTokens;
  schema?: DatabaseSchema;
  schemaRefreshedAt?: string;
  lastPing: number;
}

function tokensFromSaved(saved: SavedConnection): MicrosoftTokens | undefined {
  if (!saved.msAccessToken || !saved.msRefreshToken || !saved.msTokenExpiresAt) {
    return undefined;
  }
  return {
    accessToken: saved.msAccessToken,
    refreshToken: saved.msRefreshToken,
    expiresAt: Date.parse(saved.msTokenExpiresAt),
    tokenType: saved.msTokenType,
    scope: saved.msScope,
    accountEmail: saved.msAccountEmail,
    accountName: saved.databaseName,
    homeAccountId: saved.msHomeAccountId
  };
}

function applyTokensToSaved(saved: SavedConnection, tokens: MicrosoftTokens, label?: string): void {
  saved.msAccessToken = tokens.accessToken;
  saved.msRefreshToken = tokens.refreshToken;
  saved.msTokenExpiresAt = new Date(tokens.expiresAt).toISOString();
  saved.msTokenType = tokens.tokenType;
  saved.msScope = tokens.scope;
  saved.msAccountEmail = tokens.accountEmail;
  saved.msHomeAccountId = tokens.homeAccountId;
  if (label) {
    saved.databaseName = label;
    saved.name = label;
  }
}

class OutlookConnectionManager {
  private readonly live = new Map<string, OutlookLiveConnection>();

  isReady(connectionId: string): boolean {
    return this.live.has(connectionId);
  }

  isOpen(connectionId: string): boolean {
    return this.live.has(connectionId);
  }

  getLive(connectionId: string): OutlookLiveConnection | undefined {
    return this.live.get(connectionId);
  }

  cacheSchema(connectionId: string, schema: DatabaseSchema, introspectedAt: string): void {
    const live = this.live.get(connectionId);
    if (!live) return;
    live.schema = schema;
    live.schemaRefreshedAt = introspectedAt;
  }

  async open(saved: SavedConnection): Promise<OutlookLiveConnection> {
    if (saved.engine !== "outlook") {
      throw new AppError(400, "Not Outlook", "Connection is not an Outlook mailbox.", [], "MS_ENGINE");
    }
    const tokens = tokensFromSaved(saved);
    if (!tokens) {
      throw new AppError(
        400,
        "Outlook reconnect required",
        "Saved Microsoft tokens are missing. Connect Outlook again.",
        [],
        "MS_NO_TOKENS"
      );
    }
    const existing = this.live.get(saved.id);
    if (existing && Date.now() - existing.lastPing < 30_000) {
      return existing;
    }
    const fresh = await this.ensureFreshTokens(saved.id, tokens);
    const accountEmail = fresh.accountEmail || saved.msAccountEmail || saved.databaseName || "Outlook";
    const accountName = fresh.accountName || saved.name || accountEmail;
    const live: OutlookLiveConnection = {
      id: saved.id,
      accountEmail,
      accountName,
      tokens: fresh,
      schema: existing?.schema,
      schemaRefreshedAt: existing?.schemaRefreshedAt,
      lastPing: Date.now()
    };
    this.live.set(saved.id, live);
    return live;
  }

  async connectFromCallback(sessionId: string, code: string): Promise<{
    connectionId: string;
    accountEmail: string;
  }> {
    const tokens = await exchangeAuthorizationCode(code);
    let accountEmail = "outlook-user";
    let accountName = "Outlook";
    let graphUserId = "";
    try {
      const profile = await fetchGraphProfile(tokens.accessToken);
      accountEmail = (profile.mail || profile.userPrincipalName || accountEmail).trim();
      accountName = (profile.displayName || accountEmail).trim();
      graphUserId = profile.id;
    } catch (error) {
      logger.warn(
        { errorType: "MS_PROFILE", message: error instanceof Error ? error.message : "unknown" },
        "Could not load Microsoft profile; using placeholder label"
      );
    }

    tokens.accountEmail = accountEmail;
    tokens.accountName = accountName;
    tokens.homeAccountId = graphUserId || outlookAccountKey(accountEmail, "unknown");

    const store = getAppStore();
    const list = [...store.connections];
    const accountKey = outlookAccountKey(accountEmail, graphUserId || accountEmail);
    const existing = list.find(
      (c) =>
        c.engine === "outlook" &&
        (c.msHomeAccountId === tokens.homeAccountId ||
          c.msAccountEmail?.toLowerCase() === accountEmail.toLowerCase() ||
          c.uri === `outlook://${accountKey}`)
    );
    const now = new Date().toISOString();
    const label = accountName.includes("@") ? accountName : `${accountName} (${accountEmail})`;
    let saved: SavedConnection;
    if (existing) {
      applyTokensToSaved(existing, tokens, label);
      existing.uri = `outlook://${accountKey}`;
      existing.engine = "outlook";
      existing.serverLabel = "Microsoft Outlook";
      existing.lastUsedAt = now;
      existing.lastError = undefined;
      saved = existing;
    } else {
      saved = {
        id: uuid(),
        name: label,
        uri: `outlook://${accountKey}`,
        engine: "outlook",
        databaseName: label,
        serverLabel: "Microsoft Outlook",
        createdAt: now,
        lastUsedAt: now
      };
      applyTokensToSaved(saved, tokens, label);
      list.push(saved);
    }
    setSavedConnections(list, saved.id);

    const live = await this.open(saved);
    const schema = buildOutlookSchema(label);
    live.schema = schema;
    live.schemaRefreshedAt = schema.introspectedAt;

    const session = getOrCreateSession(sessionId);
    session.activeConnectionId = saved.id;
    session.engine = "outlook";
    session.databaseName = label;
    session.serverLabel = "Microsoft Outlook";
    session.mongoUri = saved.uri;
    session.schema = schema;
    session.schemaRefreshedAt = schema.introspectedAt;
    session.pendingQuery = undefined;

    return { connectionId: saved.id, accountEmail };
  }

  async ensureFreshTokens(connectionId: string, tokens: MicrosoftTokens): Promise<MicrosoftTokens> {
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

  async graphGet(connectionId: string, path: string): Promise<unknown> {
    const live = this.live.get(connectionId) ?? (await this.openFromStore(connectionId));
    const tokens = await this.ensureFreshTokens(connectionId, live.tokens);
    live.tokens = tokens;
    live.lastPing = Date.now();
    const url = path.startsWith("https://") ? path : `https://graph.microsoft.com/v1.0${path}`;
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
        typeof json === "object" && json && "error" in json
          ? JSON.stringify((json as { error: unknown }).error)
          : text.slice(0, 500);
      throw new AppError(response.status, "Microsoft Graph error", message, [], "MS_GRAPH");
    }
    return json;
  }

  private async openFromStore(connectionId: string): Promise<OutlookLiveConnection> {
    const saved = getAppStore().connections.find((c) => c.id === connectionId);
    if (!saved) {
      throw new AppError(404, "Unknown connection", "Outlook connection not found.", [], "NO_CONNECTION");
    }
    return this.open(saved);
  }

  close(connectionId: string): void {
    this.live.delete(connectionId);
  }
}

export const outlookConnectionManager = new OutlookConnectionManager();
