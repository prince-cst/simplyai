import type { Request, Response } from "express";
import {
  ChatBodySchema,
  ExecuteQueryBodySchema,
  ValidateQueryBodySchema
} from "../schemas/queryPlan.js";
import { runChatTurn } from "../services/chat/ChatService.js";
import { mongoConnectionManager } from "../services/mongodb/MongoConnectionManager.js";
import { executeQueryPlan } from "../services/mongodb/QueryExecutionService.js";
import { validateQueryPlan } from "../services/mongodb/QueryValidator.js";
import { executeSessionSql, validateSessionSql } from "../services/sql/sqlSession.js";
import { isOutlookEngine, isQuickBooksEngine, isSqlEngine } from "../services/sql/sqlEngine.js";
import { executeQboPlan, validateQboPlan } from "../services/quickbooks/executePlan.js";
import { executeOutlookPlan, validateOutlookPlan } from "../services/outlook/executePlan.js";
import { getOrCreateSession, clearChatContext, startNewChat } from "../services/session/SessionStore.js";
import { ensureChatTurnsFromHistory } from "../services/chat/chatTranscript.js";
import {
  deleteChatThread,
  ensureThreads,
  openChatThread,
  startNewChatThread,
  threadsSummary
} from "../services/chat/chatThreads.js";
import { AppError } from "../utils/errors.js";

function historyPayload(session: ReturnType<typeof getOrCreateSession>) {
  ensureThreads(session);
  return {
    history: session.queryHistory,
    chat: session.chatTurns,
    threads: threadsSummary(session),
    activeThreadId: session.activeThreadId ?? null
  };
}

export async function chat(req: Request, res: Response): Promise<void> {
  const body = ChatBodySchema.parse(req.body);
  const session = getOrCreateSession(req.sessionId);
  const result = await runChatTurn(session, body.message, {
    useFallback: body.useFallback,
    executePendingId: body.executePendingId,
    cancelPendingId: body.cancelPendingId
  });
  res.json(result);
}

export function validateQuery(req: Request, res: Response): void {
  const body = ValidateQueryBodySchema.parse(req.body);
  const session = getOrCreateSession(req.sessionId);
  if (!session.schema) {
    throw new AppError(400, "No schema", "Connect and inspect a database first.", [], "NO_SCHEMA");
  }
  const result = isQuickBooksEngine(session.engine)
    ? validateQboPlan(body.plan)
    : isOutlookEngine(session.engine)
      ? validateOutlookPlan(body.plan)
      : isSqlEngine(session.engine)
        ? validateSessionSql(body.plan, session.schema, session.engine)
        : validateQueryPlan(body.plan, session.schema);
  res.json(result);
}

export async function executeQuery(req: Request, res: Response): Promise<void> {
  const body = ExecuteQueryBodySchema.parse(req.body);
  const session = getOrCreateSession(req.sessionId);
  if (!session.schema) {
    throw new AppError(400, "No schema", "Connect and inspect a database first.", [], "NO_SCHEMA");
  }
  if (isQuickBooksEngine(session.engine)) {
    if (!session.activeConnectionId) {
      throw new AppError(400, "Not connected", "Not connected to QuickBooks.", [], "NOT_CONNECTED");
    }
    const checked = validateQboPlan(body.plan);
    if (!checked.ok) {
      throw new AppError(400, checked.reasons.join("; "), "Query rejected.", checked.reasons, "QUERY_REJECTED");
    }
    const result = await executeQboPlan(session.activeConnectionId, checked.plan);
    res.json(result);
    return;
  }
  if (isOutlookEngine(session.engine)) {
    if (!session.activeConnectionId) {
      throw new AppError(400, "Not connected", "Not connected to Outlook.", [], "NOT_CONNECTED");
    }
    const checked = validateOutlookPlan(body.plan);
    if (!checked.ok) {
      throw new AppError(400, checked.reasons.join("; "), "Query rejected.", checked.reasons, "QUERY_REJECTED");
    }
    const result = await executeOutlookPlan(session.activeConnectionId, checked.plan);
    res.json(result);
    return;
  }
  if (isSqlEngine(session.engine)) {
    if (!session.activeConnectionId) {
      throw new AppError(400, "Not connected", "Not connected to SQL.", [], "NOT_CONNECTED");
    }
    const checked = validateSessionSql(body.plan, session.schema, session.engine);
    if (!checked.ok) {
      throw new AppError(400, checked.reasons.join("; "), "Query rejected.", checked.reasons, "QUERY_REJECTED");
    }
    const result = await executeSessionSql(session, checked.plan);
    res.json(result);
    return;
  }
  const result = await executeQueryPlan(mongoConnectionManager.getDb(req.sessionId), session.schema, body.plan);
  res.json(result);
}

export function getHistory(req: Request, res: Response): void {
  const session = getOrCreateSession(req.sessionId);
  res.json(historyPayload(session));
}

export function clearHistory(req: Request, res: Response): void {
  const session = getOrCreateSession(req.sessionId);
  clearChatContext(session);
  mongoConnectionManager.persistSessionWorkspace(session);
  res.json({ ok: true });
}

/** Clear active chat thread only; keep Recents. */
export function newChat(req: Request, res: Response): void {
  const session = getOrCreateSession(req.sessionId);
  startNewChatThread(session);
  mongoConnectionManager.persistSessionWorkspace(session);
  res.json({ ok: true, ...historyPayload(session) });
}

/** Restore chat thread from stored query history (legacy Continue). */
export function resumeChat(req: Request, res: Response): void {
  const session = getOrCreateSession(req.sessionId);
  ensureChatTurnsFromHistory(session);
  ensureThreads(session);
  mongoConnectionManager.persistSessionWorkspace(session);
  res.json({ ok: true, ...historyPayload(session) });
}

/** Open a saved recent conversation. */
export function openThread(req: Request, res: Response): void {
  const session = getOrCreateSession(req.sessionId);
  const id = String(req.params.id || "");
  if (!openChatThread(session, id)) {
    throw new AppError(404, "Not found", "That chat was not found.", [], "THREAD_NOT_FOUND");
  }
  mongoConnectionManager.persistSessionWorkspace(session);
  res.json({ ok: true, ...historyPayload(session) });
}

/** Delete a recent conversation. */
export function deleteThread(req: Request, res: Response): void {
  const session = getOrCreateSession(req.sessionId);
  const id = String(req.params.id || "");
  if (!deleteChatThread(session, id)) {
    throw new AppError(404, "Not found", "That chat was not found.", [], "THREAD_NOT_FOUND");
  }
  mongoConnectionManager.persistSessionWorkspace(session);
  res.json({ ok: true, ...historyPayload(session) });
}
