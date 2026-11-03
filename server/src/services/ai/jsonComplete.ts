import { QueryPlanSchema, ResultExplanationSchema } from "../../schemas/queryPlan.js";
import type { QueryPlan, ResultExplanation } from "../../types/index.js";
import { parseJsonFromText } from "../../utils/json.js";
import { logger } from "../../utils/logger.js";
import {
  QUERY_PLANNER_SYSTEM_PROMPT,
  buildQueryPlannerUserPrompt
} from "../../prompts/queryPlannerPrompt.js";
import { sqlQueryPlannerSystemPrompt } from "../../prompts/sqlQueryPlannerPrompt.js";
import {
  resultExplanationSystemPrompt,
  buildResultExplanationUserPrompt
} from "../../prompts/resultExplanationPrompt.js";
import type { QueryPlanningInput, ResultExplanationInput } from "./AIProvider.js";
import { inheritedScopeFromConversation } from "../chat/followUpScope.js";
import { isOutlookEngine, isQuickBooksEngine, isSqlEngine } from "../sql/sqlEngine.js";
import { QUICKBOOKS_QUERY_PLANNER_SYSTEM_PROMPT } from "../../prompts/quickbooksQueryPlannerPrompt.js";
import { OUTLOOK_QUERY_PLANNER_SYSTEM_PROMPT } from "../../prompts/outlookQueryPlannerPrompt.js";

export async function completeJsonWithRetry(
  generate: (system: string, user: string, jsonMode: boolean) => Promise<string>,
  system: string,
  user: string
): Promise<unknown> {
  const raw = await generate(system, user, true);
  try {
    return parseJsonFromText(raw);
  } catch (first) {
    const repairUser = `Your previous response was not valid JSON. Return a single JSON object only.\nError: ${
      first instanceof Error ? first.message : "parse error"
    }\nPrevious response (truncated):\n${raw.slice(0, 1200)}`;
    const repaired = await generate(system, repairUser, true);
    return parseJsonFromText(repaired);
  }
}

export async function planFromProvider(
  generate: (system: string, user: string, jsonMode: boolean) => Promise<string>,
  input: QueryPlanningInput
): Promise<QueryPlan> {
  const user = buildQueryPlannerUserPrompt({
    question: input.question,
    compactSchemaJson: JSON.stringify(input.schema, null, 2),
    dateContextJson: JSON.stringify(input.dateContext, null, 2),
    conversationJson: JSON.stringify(input.conversation.slice(-16), null, 2),
    inheritedScope: inheritedScopeFromConversation(input.conversation)
  });
  const system = isQuickBooksEngine(input.engine)
    ? QUICKBOOKS_QUERY_PLANNER_SYSTEM_PROMPT
    : isOutlookEngine(input.engine)
      ? OUTLOOK_QUERY_PLANNER_SYSTEM_PROMPT
      : isSqlEngine(input.engine)
        ? sqlQueryPlannerSystemPrompt(input.engine)
        : QUERY_PLANNER_SYSTEM_PROMPT;
  const parsed = await completeJsonWithRetry(generate, system, user);
  const first = QueryPlanSchema.safeParse(parsed);
  if (first.success) return first.data;

  logger.warn(
    { errorType: "AI_PLAN_VALIDATE", keys: isRecord(parsed) ? Object.keys(parsed) : [] },
    first.error.message
  );

  const repairUser = `Fix this query-plan JSON. Always include "status":"ready" if the query can run.
Validation errors:
${first.error.message}

JSON to fix:
${JSON.stringify(parsed).slice(0, 4000)}

Return only the corrected JSON object.`;
  const repaired = await completeJsonWithRetry(generate, system, repairUser);
  const second = QueryPlanSchema.safeParse(repaired);
  if (second.success) return second.data;
  throw new Error(second.error.message);
}

export async function explainFromProvider(
  generate: (system: string, user: string, jsonMode: boolean) => Promise<string>,
  input: ResultExplanationInput
): Promise<ResultExplanation> {
  const system = resultExplanationSystemPrompt(input.engine);
  const user = buildResultExplanationUserPrompt({
    question: input.question,
    planJson: JSON.stringify(
      {
        operation: input.plan.operation,
        collection: input.plan.collection,
        collectionsUsed: input.plan.collectionsUsed,
        fieldsUsed: input.plan.fieldsUsed,
        assumptions: input.plan.assumptions,
        explanation: input.plan.explanation
      },
      null,
      2
    ),
    resultJson: JSON.stringify(input.result).slice(0, 12000),
    truncated: input.truncated,
    previousAnswer: input.previousAnswer,
    engine: input.engine
  });
  const parsed = await completeJsonWithRetry(generate, system, user);
  const first = ResultExplanationSchema.safeParse(parsed);
  if (first.success) return first.data;
  const repairUser = `Fix this explanation JSON.\n${first.error.message}\n${JSON.stringify(parsed).slice(0, 3000)}`;
  const repaired = await completeJsonWithRetry(generate, system, repairUser);
  return ResultExplanationSchema.parse(repaired);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
