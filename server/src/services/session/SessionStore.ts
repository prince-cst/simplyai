import { v4 as uuid } from "uuid";
import type {
  ChatThread,
  CompactChatTurn,
  DatabaseSchema,
  PendingQuery,
  QueryHistoryItem
} from "../../types/index.js";

export interface SessionState {
  id: string;
  createdAt: string;
  activeConnectionId?: string;
  mongoUri?: string;
  engine?: "mongodb" | "mysql" | "mssql" | "quickbooks" | "outlook";
  databaseName?: string;
  serverLabel?: string;
  schema?: DatabaseSchema;
  schemaRefreshedAt?: string;
  chatTurns: CompactChatTurn[];
  queryHistory: QueryHistoryItem[];
  threads: ChatThread[];
  activeThreadId?: string;
  pendingQuery?: PendingQuery;
}

const sessions = new Map<string, SessionState>();

export function getOrCreateSession(id?: string): SessionState {
  if (id && sessions.has(id)) {
    return sessions.get(id)!;
  }
  const session: SessionState = {
    id: id && id.length > 8 ? id : uuid(),
    createdAt: new Date().toISOString(),
    chatTurns: [],
    queryHistory: [],
    threads: []
  };
  sessions.set(session.id, session);
  return session;
}

export function getSession(id: string): SessionState | undefined {
  return sessions.get(id);
}

export function resetDatabaseContext(session: SessionState): void {
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
  session.engine = undefined;
}

/** Clears active thread and all recents / query history. */
export function clearChatContext(session: SessionState): void {
  session.chatTurns = [];
  session.queryHistory = [];
  session.threads = [];
  session.activeThreadId = undefined;
  session.pendingQuery = undefined;
}

/** Starts a blank chat thread but keeps saved recents. */
export function startNewChat(session: SessionState): void {
  session.chatTurns = [];
  session.pendingQuery = undefined;
  session.activeThreadId = undefined;
}
