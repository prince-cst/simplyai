import { describe, expect, it } from "vitest";
import { parseJsonFromText } from "../src/utils/json.js";
import { QueryPlanSchema } from "../src/schemas/queryPlan.js";

describe("json + query plan schema", () => {
  it("parses fenced JSON", () => {
    const value = parseJsonFromText("```json\n{\"ok\":true}\n```");
    expect(value).toEqual({ ok: true });
  });

  it("accepts a valid query plan", () => {
    const parsed = QueryPlanSchema.parse({
      status: "ready",
      operation: "count",
      collection: "orders",
      explanation: "count",
      collectionsUsed: ["orders"],
      fieldsUsed: ["_id"],
      assumptions: [],
      confidence: 0.8
    });
    expect(parsed.operation).toBe("count");
  });

  it("defaults status to ready when Ollama omits it", () => {
    const parsed = QueryPlanSchema.parse({
      operation: "count",
      collection: "orders",
      explanation: "count documents"
    });
    expect(parsed.status).toBe("ready");
    expect(parsed.collectionsUsed).toEqual(["orders"]);
  });

  it("strips think tags before parsing JSON", () => {
    const value = parseJsonFromText("<think>reasoning</think>{\"operation\":\"count\"}");
    expect(value).toEqual({ operation: "count" });
  });
});
