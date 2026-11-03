import type { AIProvider } from "../ai/AIProvider.js";
import { AppError } from "../../utils/errors.js";
import type { QueryPlan, ResultExplanation } from "../../types/index.js";

export class ResultExplanationService {
  constructor(private readonly provider: AIProvider) {}

  async explain(input: {
    question: string;
    plan: QueryPlan;
    result: unknown;
    truncated: boolean;
    previousAnswer?: string;
    engine?: "mongodb" | "mysql" | "mssql" | "quickbooks" | "outlook";
  }): Promise<ResultExplanation> {
    try {
      return await this.provider.explainResult({
        question: input.question,
        plan: input.plan,
        result: input.result,
        truncated: input.truncated,
        previousAnswer: input.previousAnswer,
        engine: input.engine
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        502,
        error instanceof Error ? error.message : "Explainer failed",
        "The AI could not explain the database result.",
        ["The query ran successfully; you can still inspect the raw data."],
        "AI_EXPLAIN"
      );
    }
  }
}
