import { v4 as uuid } from "uuid";
import type { AIProvider } from "../ai/AIProvider.js";
import { createAIProvider } from "../ai/AIProviderFactory.js";
import { getRuntimeSettings } from "../../config/runtimeSettings.js";
import { AppError } from "../../utils/errors.js";
import { logger } from "../../utils/logger.js";
import { sanitizeMongoError } from "../../utils/mask.js";
import { mongoConnectionManager } from "../mongodb/MongoConnectionManager.js";
import { executeQueryPlan } from "../mongodb/QueryExecutionService.js";
import { validateQueryPlan } from "../mongodb/QueryValidator.js";
import { executeSessionSql, validateSessionSql } from "../sql/sqlSession.js";
import { isOutlookEngine, isQuickBooksEngine, isSqlEngine, sqlProductLabel } from "../sql/sqlEngine.js";
import { executeQboPlan, validateQboPlan } from "../quickbooks/executePlan.js";
import { executeOutlookPlan, validateOutlookPlan } from "../outlook/executePlan.js";
import { refreshSchema } from "../schemaRefresh.js";
import { QueryPlannerService } from "./QueryPlannerService.js";
import { ResultExplanationService } from "./ResultExplanationService.js";
import { focusFromAnswer, lastAssistantAnswer } from "./followUpScope.js";
import type { SessionState } from "../session/SessionStore.js";
import { syncActiveThread } from "./chatThreads.js";
import type {
  QueryPlan,
  ResultExplanation,
  QueryExecutionResult,
  AIProviderName
} from "../../types/index.js";

export interface ChatResponse {
  status: "answered" | "needs_clarification" | "insufficient_data" | "pending_approval" | "cancelled";
  question: string;
  answer?: string;
  explanation?: ResultExplanation;
  result?: QueryExecutionResult;
  queryPlan?: QueryPlan;
  validation?: { ok: boolean; reasons: string[] };
  pendingId?: string;
  provider: AIProviderName;
  model: string;
  usedFallback: boolean;
  canFallback: boolean;
  rotatedFromModel?: string;
  developer?: Record<string, unknown>;
}

function compactResult(result: QueryExecutionResult): unknown {
  return result.documents.slice(0, 30);
}

async function planWithRepair(
  planner: QueryPlannerService,
  session: SessionState,
  question: string
): Promise<QueryPlan> {
  if (!session.schema) {
    throw new AppError(400, "No schema", "Refresh the database schema before asking questions.", [], "NO_SCHEMA");
  }
  return planner.plan({
    question,
    schema: session.schema,
    conversation: session.chatTurns,
    engine: session.engine
  });
}

async function executeWithOneRepair(
  provider: AIProvider,
  session: SessionState,
  question: string,
  plan: QueryPlan
): Promise<{ plan: QueryPlan; result: QueryExecutionResult; validation: { ok: boolean; reasons: string[] } }> {
  if (!session.schema) {
    throw new AppError(400, "No schema", "No schema is loaded.", [], "NO_SCHEMA");
  }
  if (isQuickBooksEngine(session.engine)) {
    if (!session.activeConnectionId) {
      throw new AppError(400, "Not connected", "Not connected to QuickBooks.", [], "NOT_CONNECTED");
    }
    const validation = validateQboPlan(plan);
    if (!validation.ok) {
      throw new AppError(
        400,
        validation.reasons.join("; "),
        "The AI generated a QuickBooks plan that was rejected by the safety validator.",
        validation.reasons,
        "QUERY_REJECTED"
      );
    }
    try {
      const result = await executeQboPlan(session.activeConnectionId, validation.plan);
      return { plan: validation.plan, result, validation: { ok: true, reasons: [] } };
    } catch (error) {
      const sanitized = sanitizeMongoError(error instanceof Error ? error.message : "query failed");
      logger.warn({ operation: "qbo", collection: plan.collection, errorType: "QB_QUERY" }, "QuickBooks call failed, attempting one repair");
      const repaired = await provider.generateQueryPlan({
        question: `${question}\n\nThe previous QuickBooks read failed with this sanitized error:\n${sanitized}\nReturn a corrected query plan JSON with operation "qbo".`,
        schema: {
          database: session.schema.database,
          collections: session.schema.collections.map((c) => ({
            name: c.name,
            estimatedCount: c.estimatedCount,
            fields: Object.fromEntries(c.fields.map((f) => [f.path, f.type])),
            dateFields: c.fields.filter((f) => f.type === "date").map((f) => f.path),
            numericFields: c.fields.filter((f) => f.isNumeric).map((f) => f.path),
            possibleIdFields: c.fields.filter((f) => f.isPossibleId).map((f) => f.path)
          })),
          relationships: session.schema.relationships,
          note: "Repair attempt for QuickBooks Online API plan."
        },
        dateContext: { note: "Repair retry" },
        conversation: session.chatTurns,
        engine: session.engine
      });
      const v2 = validateQboPlan(repaired);
      if (!v2.ok) {
        throw new AppError(
          400,
          v2.reasons.join("; "),
          "The AI generated a QuickBooks plan that was rejected by the safety validator.",
          v2.reasons,
          "QUERY_REJECTED"
        );
      }
      const result = await executeQboPlan(session.activeConnectionId, v2.plan);
      return { plan: v2.plan, result, validation: { ok: true, reasons: [] } };
    }
  }
  if (isOutlookEngine(session.engine)) {
    if (!session.activeConnectionId) {
      throw new AppError(400, "Not connected", "Not connected to Outlook.", [], "NOT_CONNECTED");
    }
    const validation = validateOutlookPlan(plan);
    if (!validation.ok) {
      throw new AppError(
        400,
        validation.reasons.join("; "),
        "The AI generated an Outlook plan that was rejected by the safety validator.",
        validation.reasons,
        "QUERY_REJECTED"
      );
    }
    try {
      const result = await executeOutlookPlan(session.activeConnectionId, validation.plan);
      return { plan: validation.plan, result, validation: { ok: true, reasons: [] } };
    } catch (error) {
      const sanitized = sanitizeMongoError(error instanceof Error ? error.message : "query failed");
      logger.warn(
        { operation: "outlook", collection: plan.collection, errorType: "MS_QUERY" },
        "Outlook Graph call failed, attempting one repair"
      );
      const repaired = await provider.generateQueryPlan({
        question: `${question}\n\nThe previous Outlook read failed with this sanitized error:\n${sanitized}\nReturn a corrected query plan JSON with operation "outlook".`,
        schema: {
          database: session.schema.database,
          collections: session.schema.collections.map((c) => ({
            name: c.name,
            estimatedCount: c.estimatedCount,
            fields: Object.fromEntries(c.fields.map((f) => [f.path, f.type])),
            dateFields: c.fields.filter((f) => f.type === "date").map((f) => f.path),
            numericFields: c.fields.filter((f) => f.isNumeric).map((f) => f.path),
            possibleIdFields: c.fields.filter((f) => f.isPossibleId).map((f) => f.path)
          })),
          relationships: session.schema.relationships,
          note: "Repair attempt for Outlook / Microsoft Graph mail plan."
        },
        dateContext: { note: "Repair retry" },
        conversation: session.chatTurns,
        engine: session.engine
      });
      const v2 = validateOutlookPlan(repaired);
      if (!v2.ok) {
        throw new AppError(
          400,
          v2.reasons.join("; "),
          "The AI generated an Outlook plan that was rejected by the safety validator.",
          v2.reasons,
          "QUERY_REJECTED"
        );
      }
      const result = await executeOutlookPlan(session.activeConnectionId, v2.plan);
      return { plan: v2.plan, result, validation: { ok: true, reasons: [] } };
    }
  }
  if (isSqlEngine(session.engine)) {
    if (!session.activeConnectionId) {
      throw new AppError(400, "Not connected", `Not connected to ${sqlProductLabel(session.engine)}.`, [], "NOT_CONNECTED");
    }
    const validation = validateSessionSql(plan, session.schema, session.engine);
    if (!validation.ok) {
      throw new AppError(
        400,
        validation.reasons.join("; "),
        "The AI generated a query that was rejected by the safety validator.",
        validation.reasons,
        "QUERY_REJECTED"
      );
    }
    try {
      const result = await executeSessionSql(session, validation.plan);
      return { plan: validation.plan, result, validation: { ok: true, reasons: [] } };
    } catch (error) {
      const sanitized = sanitizeMongoError(error instanceof Error ? error.message : "query failed");
      logger.warn({ operation: "sql", collection: plan.collection, errorType: "SQL_QUERY" }, "Query failed, attempting one repair");
      const repaired = await provider.generateQueryPlan({
        question: `${question}\n\nThe previous read-only SQL failed with this sanitized error:\n${sanitized}\nReturn a corrected query plan JSON with operation "sql".`,
        schema: {
          database: session.schema.database,
          collections: session.schema.collections.map((c) => ({
            name: c.name,
            estimatedCount: c.estimatedCount,
            fields: Object.fromEntries(c.fields.map((f) => [f.path, f.type])),
            dateFields: c.fields.filter((f) => f.type === "date").map((f) => f.path),
            numericFields: c.fields.filter((f) => f.isNumeric).map((f) => f.path),
            possibleIdFields: c.fields.filter((f) => f.isPossibleId).map((f) => f.path)
          })),
          relationships: session.schema.relationships,
          note: `Repair attempt. Tables are ${sqlProductLabel(session.engine)} tables.`
        },
        dateContext: { note: "Repair retry" },
        conversation: session.chatTurns,
        engine: session.engine
      });
      const v2 = validateSessionSql(repaired, session.schema, session.engine);
      if (!v2.ok) {
        throw new AppError(
          400,
          v2.reasons.join("; "),
          "The AI generated a query that was rejected by the safety validator.",
          v2.reasons,
          "QUERY_REJECTED"
        );
      }
      const result = await executeSessionSql(session, v2.plan);
      return { plan: v2.plan, result, validation: { ok: true, reasons: [] } };
    }
  }
  const db = mongoConnectionManager.getDb(session.id);
  const validation = validateQueryPlan(plan, session.schema);
  if (!validation.ok) {
    throw new AppError(
      400,
      validation.reasons.join("; "),
      "The AI generated a query that was rejected by the safety validator.",
      validation.reasons,
      "QUERY_REJECTED"
    );
  }
  try {
    const result = await executeQueryPlan(db, session.schema, validation.plan);
    return {
      plan: result.executedPlan ?? validation.plan,
      result,
      validation: { ok: true, reasons: [] }
    };
  } catch (error) {
    const sanitized = sanitizeMongoError(error instanceof Error ? error.message : "query failed");
    logger.warn({ operation: plan.operation, collection: plan.collection, errorType: "MONGO_QUERY" }, "Query failed, attempting one repair");
    const repaired = await provider.generateQueryPlan({
      question: `${question}\n\nThe previous read-only query failed with this sanitized MongoDB error:\n${sanitized}\nReturn a corrected query plan JSON.`,
      schema: {
        database: session.schema.database,
        collections: session.schema.collections.map((c) => ({
          name: c.name,
          estimatedCount: c.estimatedCount,
          fields: Object.fromEntries(c.fields.map((f) => [f.path, f.type])),
          dateFields: c.fields.filter((f) => f.type === "date").map((f) => f.path),
          numericFields: c.fields.filter((f) => f.isNumeric).map((f) => f.path),
          possibleIdFields: c.fields.filter((f) => f.isPossibleId).map((f) => f.path)
        })),
        relationships: session.schema.relationships,
        note: "Repair attempt. Relationships are inferred."
      },
      dateContext: { note: "Repair retry" },
      conversation: session.chatTurns
    });
    const v2 = validateQueryPlan(repaired, session.schema);
    if (!v2.ok) {
      throw new AppError(
        400,
        v2.reasons.join("; "),
        "The AI generated a query that was rejected by the safety validator.",
        v2.reasons,
        "QUERY_REJECTED"
      );
    }
    const result = await executeQueryPlan(db, session.schema, v2.plan);
    return {
      plan: result.executedPlan ?? v2.plan,
      result,
      validation: { ok: true, reasons: [] }
    };
  }
}

export async function runChatTurn(
  session: SessionState,
  question: string,
  options: { useFallback?: boolean; executePendingId?: string; cancelPendingId?: string; providerOverride?: AIProvider }
): Promise<ChatResponse> {
  const settings = getRuntimeSettings();
  const canFallback = Boolean(settings.fallbackProvider && settings.fallbackProvider !== settings.provider);

  if (options.cancelPendingId) {
    if (session.pendingQuery?.id === options.cancelPendingId) {
      session.pendingQuery = undefined;
    }
    return {
      status: "cancelled",
      question,
      provider: settings.provider,
      model: currentModel(settings.provider),
      usedFallback: false,
      canFallback
    };
  }

  await mongoConnectionManager.ensureLive(session.id);
  if (mongoConnectionManager.isConnected(session.id) && !session.schema) {
    await refreshSchema(session.id);
  }

  if (!mongoConnectionManager.isConnected(session.id) || !session.schema) {
    throw new AppError(
      400,
      "Not connected",
      "Connect to MongoDB, MySQL, SQL Server, QuickBooks, or Outlook and inspect the schema before asking questions.",
      ["Demo mode is available until you connect. Run: npm run seed:test"],
      "NOT_CONNECTED"
    );
  }

  let usedFallback = false;
  const provider: AIProvider =
    options.providerOverride ??
    createAIProvider(settings, options.useFallback ? settings.fallbackProvider : undefined);
  usedFallback = Boolean(options.useFallback && settings.fallbackProvider);

  if (options.executePendingId) {
    if (!session.pendingQuery || session.pendingQuery.id !== options.executePendingId) {
      throw new AppError(400, "No pending query", "There is no query waiting for approval.", [], "NO_PENDING");
    }
    const pending = session.pendingQuery;
    session.pendingQuery = undefined;
    return finishExecution(session, provider, pending.question, pending.plan, usedFallback, canFallback, settings.developerMode);
  }

  const planner = new QueryPlannerService(provider);
  const plan = await planWithRepair(planner, session, question);

  if (plan.status === "needs_clarification") {
    const answer = plan.explanation || "I need clarification.";
    recordTurn(session, question, answer, plan, {
      provider: provider.name,
      model: provider.model,
      executionTimeMs: 0,
      success: true
    });
    return {
      status: "needs_clarification",
      question,
      answer: plan.explanation || "I need clarification.",
      queryPlan: plan,
      provider: provider.name,
      model: provider.model,
      usedFallback,
      canFallback,
      rotatedFromModel: provider.quotaRotatedFrom,
      developer: settings.developerMode ? debugPayload(provider, plan) : undefined
    };
  }

  if (plan.status === "insufficient_data") {
    const answer =
      plan.explanation ||
      "I couldn't find a field or collection containing enough information to answer this reliably.";
    recordTurn(session, question, answer, plan, {
      provider: provider.name,
      model: provider.model,
      executionTimeMs: 0,
      success: false
    });
    return {
      status: "insufficient_data",
      question,
      answer:
        plan.explanation ||
        "I couldn't find a field or collection containing enough information to answer this reliably.",
      queryPlan: plan,
      provider: provider.name,
      model: provider.model,
      usedFallback,
      canFallback,
      rotatedFromModel: provider.quotaRotatedFrom,
      developer: settings.developerMode ? debugPayload(provider, plan) : undefined
    };
  }

  if (settings.requireQueryApproval) {
    const pendingId = uuid();
    session.pendingQuery = { id: pendingId, question, plan, createdAt: new Date().toISOString() };
    return {
      status: "pending_approval",
      question,
      queryPlan: plan,
      pendingId,
      provider: provider.name,
      model: provider.model,
      usedFallback,
      canFallback,
      rotatedFromModel: provider.quotaRotatedFrom,
      developer: settings.developerMode ? debugPayload(provider, plan) : undefined
    };
  }

  return finishExecution(session, provider, question, plan, usedFallback, canFallback, settings.developerMode);
}

async function finishExecution(
  session: SessionState,
  provider: AIProvider,
  question: string,
  plan: QueryPlan,
  usedFallback: boolean,
  canFallback: boolean,
  developerMode: boolean
): Promise<ChatResponse> {
  const started = Date.now();
  const { plan: finalPlan, result, validation } = await executeWithOneRepair(
    provider,
    session,
    question,
    plan
  );
  const explainer = new ResultExplanationService(provider);
  const explanation = await explainer.explain({
    question,
    plan: finalPlan,
    result: compactResult(result),
    truncated: result.truncated,
    previousAnswer: lastAssistantAnswer(session.chatTurns),
    engine: session.engine
  });

  recordTurn(session, question, explanation.answer, finalPlan, {
    provider: provider.name,
    model: provider.model,
    executionTimeMs: Date.now() - started,
    success: !explanation.insufficientData
  });

  return {
    status: explanation.insufficientData ? "insufficient_data" : "answered",
    question,
    answer: explanation.answer,
    explanation,
    result,
    queryPlan: finalPlan,
    validation,
    provider: provider.name,
    model: provider.model,
    usedFallback,
    canFallback,
    rotatedFromModel: provider.quotaRotatedFrom,
    developer: developerMode
      ? debugPayload(provider, finalPlan, result, explanation)
      : undefined
  };
}

function recordTurn(
  session: SessionState,
  question: string,
  answer: string,
  plan: QueryPlan,
  meta: {
    provider: AIProviderName;
    model: string;
    executionTimeMs: number;
    success: boolean;
  }
): void {
  const id = uuid();
  session.queryHistory.unshift({
    id,
    question,
    answer: answer.slice(0, 2000),
    timestamp: new Date().toISOString(),
    provider: meta.provider,
    model: meta.model,
    collectionsUsed: plan.collectionsUsed,
    fieldsUsed: plan.fieldsUsed,
    executionTimeMs: meta.executionTimeMs,
    success: meta.success,
    status: plan.status,
    focus: focusFromAnswer(answer, [
      plan.dateIntents?.length ? `dateIntents:${JSON.stringify(plan.dateIntents)}` : "",
      plan.collection ? `scope:${plan.collection}` : ""
    ])
  });
  session.queryHistory = session.queryHistory.slice(0, 100);
  rememberTurn(session, question, answer, plan, id);
  mongoConnectionManager.persistSessionWorkspace(session);
}

function rememberTurn(
  session: SessionState,
  question: string,
  answer: string,
  plan: QueryPlan,
  historyId?: string
): void {
  session.chatTurns.push({
    role: "user",
    question,
    historyId
  });
  session.chatTurns.push({
    role: "assistant",
    answer: answer.slice(0, 800),
    collectionsUsed: plan.collectionsUsed,
    fieldsUsed: plan.fieldsUsed.slice(0, 12),
    lastCollection: plan.collection,
    dateIntents: plan.dateIntents,
    sql: plan.sql?.slice(0, 500),
    focus: focusFromAnswer(answer, [
      plan.dateIntents?.length ? `Keep this date scope: ${JSON.stringify(plan.dateIntents)}` : "",
      plan.collection ? `Primary table/collection: ${plan.collection}` : "",
      plan.sql ? `Previous SQL: ${plan.sql.slice(0, 400)}` : ""
    ]),
    historyId
  });
  session.chatTurns = session.chatTurns.slice(-40);
  syncActiveThread(session);
}

function currentModel(provider: AIProviderName): string {
  const s = getRuntimeSettings();
  if (provider === "ollama") return s.ollama.model;
  if (provider === "gemini") return s.gemini.model;
  return s.groq.model;
}

function debugPayload(
  provider: AIProvider,
  plan: QueryPlan,
  result?: QueryExecutionResult,
  explanation?: ResultExplanation
): Record<string, unknown> {
  return {
    provider: provider.name,
    model: provider.model,
    queryPlan: plan,
    resultCount: result?.resultCount,
    executionTimeMs: result?.executionTimeMs,
    truncated: result?.truncated,
    explanation
  };
}
