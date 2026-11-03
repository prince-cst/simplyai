import type { AIProvider } from "../ai/AIProvider.js";
import { AppError } from "../../utils/errors.js";
import { currentDateContext } from "../../utils/dates.js";
import { toCompactSchema } from "../mongodb/SchemaInferenceService.js";
import type { DatabaseSchema, QueryPlan } from "../../types/index.js";
import { getRuntimeSettings } from "../../config/runtimeSettings.js";
import type { CompactChatTurn } from "../../types/index.js";
import { isSqlEngine, sqlProductLabel } from "../sql/sqlEngine.js";

export class QueryPlannerService {
  constructor(private readonly provider: AIProvider) {}

  async plan(input: {
    question: string;
    schema: DatabaseSchema;
    conversation: CompactChatTurn[];
    engine?: "mongodb" | "mysql" | "mssql" | "quickbooks" | "outlook";
  }): Promise<QueryPlan> {
    try {
      const compact = toCompactSchema(input.schema, input.engine ?? "mongodb");
      if (isSqlEngine(input.engine)) {
        compact.note = `These collections are ${sqlProductLabel(input.engine)} tables and fields are columns. Use SQL JOINs. Relationships may include declared foreign keys. Put date filters in the SQL WHERE clause using ISO date literals from the date context — do not rely on MongoDB-style dateIntents injection.`;
      }
      return await this.provider.generateQueryPlan({
        question: input.question,
        schema: compact,
        dateContext: currentDateContext(getRuntimeSettings().timezone),
        conversation: input.conversation,
        engine: input.engine
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      const detail = error instanceof Error ? error.message : "Planner failed";
      throw new AppError(
        502,
        detail,
        "The AI query planner returned an invalid plan.",
        [
          "Ollama did respond, but the JSON was missing required fields.",
          "Retry the question",
          "A smaller instruction-tuned model often follows the plan schema better",
          "Enable Developer Mode to inspect the schema"
        ],
        "AI_PLAN"
      );
    }
  }
}
