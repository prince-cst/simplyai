import { describe, expect, it } from "vitest";
import { validateQueryPlan } from "../src/services/mongodb/QueryValidator.js";
import { buildDatabaseSchema, inferFieldsFromDocuments } from "../src/services/mongodb/SchemaInferenceService.js";
import type { QueryPlan } from "../src/types/index.js";

const schema = buildDatabaseSchema("shopdb", [
  {
    name: "orders",
    estimatedCount: 10,
    sampleSize: 1,
    fields: inferFieldsFromDocuments([{ quantity: 1, sellingPrice: 2, createdAt: new Date() }]),
    sampleDocuments: []
  },
  {
    name: "products",
    estimatedCount: 4,
    sampleSize: 1,
    fields: inferFieldsFromDocuments([{ name: "Laptop" }]),
    sampleDocuments: []
  }
]);

function plan(partial: Partial<QueryPlan>): QueryPlan {
  return {
    status: "ready",
    operation: "find",
    collection: "orders",
    explanation: "test",
    collectionsUsed: ["orders"],
    fieldsUsed: [],
    assumptions: [],
    confidence: 1,
    ...partial
  };
}

describe("query validator", () => {
  it("allows find on a known collection", () => {
    const result = validateQueryPlan(plan({ limit: 10 }), schema);
    expect(result.ok).toBe(true);
  });

  it("rejects unknown collections", () => {
    const result = validateQueryPlan(plan({ collection: "secrets" }), schema);
    expect(result.ok).toBe(false);
  });

  it("rejects $out and $where", () => {
    expect(
      validateQueryPlan(
        plan({ operation: "aggregate", pipeline: [{ $out: "x" }] }),
        schema
      ).ok
    ).toBe(false);
    expect(validateQueryPlan(plan({ filter: { $where: "1" } }), schema).ok).toBe(false);
  });

  it("rejects $lookup to unknown collections", () => {
    const result = validateQueryPlan(
      plan({
        operation: "aggregate",
        pipeline: [{ $lookup: { from: "passwords", localField: "x", foreignField: "_id", as: "p" } }]
      }),
      schema
    );
    expect(result.ok).toBe(false);
  });

  it("allows $lookup to discovered collections", () => {
    const result = validateQueryPlan(
      plan({
        operation: "aggregate",
        pipeline: [
          { $lookup: { from: "products", localField: "productId", foreignField: "_id", as: "p" } },
          { $limit: 10 }
        ]
      }),
      schema
    );
    expect(result.ok).toBe(true);
  });

  it("caps find limit", () => {
    const result = validateQueryPlan(plan({ limit: 100 }), schema);
    expect(result.plan.limit).toBeLessThanOrEqual(100);
  });
});
