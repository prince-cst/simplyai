import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CompactChatTurn,
  ChatThread,
  QueryHistoryItem,
  RuntimeSettings,
  TriggerDefinition
} from "../types/index.js";
import { logger } from "../utils/logger.js";

export interface SavedConnection {
  id: string;
  name: string;
  uri: string;
  engine?: "mongodb" | "mysql" | "mssql" | "quickbooks" | "outlook";
  databaseName?: string;
  serverLabel?: string;
  createdAt: string;
  lastUsedAt: string;
  lastError?: string;
  /** QuickBooks OAuth tokens (sandbox/dev local store only). */
  qbRealmId?: string;
  qbAccessToken?: string;
  qbRefreshToken?: string;
  qbTokenExpiresAt?: string;
  qbRefreshTokenExpiresAt?: string;
  qbTokenType?: string;
  /** Microsoft Graph / Outlook OAuth tokens (local store only). */
  msHomeAccountId?: string;
  msAccountEmail?: string;
  msAccessToken?: string;
  msRefreshToken?: string;
  msTokenExpiresAt?: string;
  msTokenType?: string;
  msScope?: string;
}

export interface ConnectionWorkspace {
  chatTurns: CompactChatTurn[];
  queryHistory: QueryHistoryItem[];
  threads?: ChatThread[];
  activeThreadId?: string;
}

export interface AppStoreData {
  version: 1;
  settings?: RuntimeSettings;
  connections: SavedConnection[];
  activeConnectionId?: string;
  chats: Record<string, ConnectionWorkspace>;
  triggers: TriggerDefinition[];
}

export function emptyAppStore(): AppStoreData {
  return { version: 1, connections: [], chats: {}, triggers: [] };
}

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultPath = path.resolve(here, "../../data/app-store.json");

let persistToDisk = process.env.VITEST !== "true";
let storePath = process.env.APP_STORE_PATH || defaultPath;
let data: AppStoreData = emptyAppStore();
let loaded = false;

export function configureAppStore(options: { persist?: boolean; filePath?: string; snapshot?: AppStoreData }): void {
  if (options.persist !== undefined) persistToDisk = options.persist;
  if (options.filePath) storePath = options.filePath;
  if (options.snapshot) {
    data = options.snapshot;
    loaded = true;
  } else if (options.filePath) {
    loaded = false;
  }
}

export function getAppStorePath(): string {
  return storePath;
}

export function loadAppStore(): AppStoreData {
  if (loaded) return data;
  loaded = true;
  if (!persistToDisk) {
    data = emptyAppStore();
    return data;
  }
  try {
    if (!fs.existsSync(storePath)) {
      data = emptyAppStore();
      return data;
    }
    const raw = fs.readFileSync(storePath, "utf8");
    const parsed = JSON.parse(raw) as AppStoreData;
    data = {
      version: 1,
      settings: parsed.settings,
      connections: Array.isArray(parsed.connections) ? parsed.connections : [],
      activeConnectionId: parsed.activeConnectionId,
      chats: parsed.chats && typeof parsed.chats === "object" ? parsed.chats : {},
      triggers: Array.isArray(parsed.triggers) ? parsed.triggers : []
    };
  } catch (error) {
    logger.warn(
      { errorType: "APP_STORE_LOAD", message: error instanceof Error ? error.message : "load failed" },
      "Could not load project store; starting empty"
    );
    data = emptyAppStore();
  }
  return data;
}

export function getAppStore(): AppStoreData {
  if (!loaded) loadAppStore();
  return data;
}

export function saveAppStore(): void {
  if (!loaded) loadAppStore();
  if (!persistToDisk) return;
  try {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    const tmp = `${storePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: "utf8" });
    try {
      fs.renameSync(tmp, storePath);
    } catch {
      fs.copyFileSync(tmp, storePath);
      fs.unlinkSync(tmp);
    }
  } catch (error) {
    logger.warn(
      { errorType: "APP_STORE_SAVE", message: error instanceof Error ? error.message : "save failed" },
      "Could not save project store"
    );
  }
}

export function setStoreSettings(settings: RuntimeSettings): void {
  const store = getAppStore();
  store.settings = settings;
  saveAppStore();
}

export function setSavedConnections(connections: SavedConnection[], activeConnectionId?: string): void {
  const store = getAppStore();
  store.connections = connections;
  store.activeConnectionId = activeConnectionId;
  saveAppStore();
}

export function persistWorkspace(connectionId: string, workspace: ConnectionWorkspace): void {
  const store = getAppStore();
  store.chats[connectionId] = {
    chatTurns: workspace.chatTurns.slice(-40),
    queryHistory: workspace.queryHistory.slice(0, 100),
    threads: (workspace.threads ?? []).slice(0, 40).map((t) => ({
      ...t,
      chatTurns: t.chatTurns.slice(-40)
    })),
    activeThreadId: workspace.activeThreadId
  };
  saveAppStore();
}

export function readWorkspace(connectionId: string): ConnectionWorkspace {
  const store = getAppStore();
  return store.chats[connectionId] ?? { chatTurns: [], queryHistory: [], threads: [] };
}

export function deleteWorkspace(connectionId: string): void {
  const store = getAppStore();
  delete store.chats[connectionId];
  saveAppStore();
}

export function emptyWorkspace(): ConnectionWorkspace {
  return { chatTurns: [], queryHistory: [], threads: [] };
}

export function listTriggers(): TriggerDefinition[] {
  return getAppStore().triggers ?? [];
}

export function getTrigger(id: string): TriggerDefinition | undefined {
  return listTriggers().find((t) => t.id === id);
}

export function setTriggers(triggers: TriggerDefinition[]): void {
  const store = getAppStore();
  store.triggers = triggers;
  saveAppStore();
}

export function upsertTrigger(trigger: TriggerDefinition): TriggerDefinition {
  const store = getAppStore();
  const list = [...(store.triggers ?? [])];
  const idx = list.findIndex((t) => t.id === trigger.id);
  if (idx >= 0) list[idx] = trigger;
  else list.unshift(trigger);
  store.triggers = list;
  saveAppStore();
  return trigger;
}

export function removeTrigger(id: string): boolean {
  const store = getAppStore();
  const before = store.triggers?.length ?? 0;
  store.triggers = (store.triggers ?? []).filter((t) => t.id !== id);
  if ((store.triggers.length ?? 0) === before) return false;
  saveAppStore();
  return true;
}
