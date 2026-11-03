import { MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { env } from "../config/env.js";
import { seedTestShopDatabase } from "../seed/seedTestShopDatabase.js";
import { introspectDatabase } from "../services/mongodb/MongoIntrospectionService.js";
import { buildDatabaseSchema } from "../services/mongodb/SchemaInferenceService.js";
import { validateQueryPlan } from "../services/mongodb/QueryValidator.js";
import { executeQueryPlan } from "../services/mongodb/QueryExecutionService.js";
import { MockAIProvider } from "../services/ai/MockAIProvider.js";
import { createAIProvider } from "../services/ai/AIProviderFactory.js";
import { resolveDateRange } from "../utils/dates.js";
import type { QueryPlan } from "../types/index.js";

interface Step {
  name: string;
  ok: boolean;
  detail: string;
}

const steps: Step[] = [];

function record(name: string, ok: boolean, detail: string): void {
  steps.push({ name, ok, detail });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name} — ${detail}`);
}

async function mongoUri(): Promise<{ uri: string; stop?: () => Promise<void> }> {
  const candidate = env.mongoUri;
  try {
    const client = new MongoClient(candidate, { serverSelectionTimeoutMS: 2500 });
    await client.connect();
    await client.close();
    return { uri: candidate };
  } catch {
    const mem = await MongoMemoryServer.create();
    return { uri: mem.getUri(), stop: async () => { await mem.stop(); } };
  }
}

async function main(): Promise<void> {
  console.log("Universal MongoDB AI Assistant — end-to-end test");
  console.log("");

  const month = resolveDateRange("this_month", env.timezone);
  record(
    "Date utilities",
    month.start < month.end,
    `this_month ${month.start.toISOString()} → ${month.end.toISOString()}`
  );

  try {
    createAIProvider({
      provider: "ollama",
      ollama: { baseUrl: "http://localhost:11434", model: "qwen3" },
      gemini: { apiKey: "", model: "gemini-2.5-flash" },
      groq: { apiKey: "", model: "llama-3.3-70b-versatile" },
      requireQueryApproval: false,
      developerMode: false,
      sampleDocumentsPerCollection: 10,
      maxResultDocuments: 100,
      maxSampleDocuments: 10,
      maxPipelineStages: 30,
      queryTimeoutMs: 15000,
      timezone: "Asia/Kolkata"
    });
    record("Provider factory (Ollama)", true, "Created OllamaProvider");
  } catch (error) {
    record("Provider factory (Ollama)", false, error instanceof Error ? error.message : "fail");
  }

  const { uri, stop } = await mongoUri();
  const client = new MongoClient(uri);
  try {
    await client.connect();
    record("MongoDB connection", true, uri.includes("127.0.0.1") || uri.includes("localhost") ? "local/memory" : "configured URI");

    const db = client.db("test_shop_db_e2e");
    const seeded = await seedTestShopDatabase(db);
    record("Seed test database", seeded.orders > 50, `${seeded.orders} orders`);

    const collections = await introspectDatabase(db, { sampleDocumentsPerCollection: 10 });
    const schema = buildDatabaseSchema(db.databaseName, collections);
    record(
      "Schema introspection",
      schema.collections.length === 4 && schema.relationships.length > 0,
      `${schema.collections.length} collections, ${schema.relationships.length} relationships`
    );

    const bad: QueryPlan = {
      status: "ready",
      operation: "aggregate",
      collection: "orders",
      pipeline: [{ $out: "hacked" }],
      explanation: "bad",
      collectionsUsed: ["orders"],
      fieldsUsed: [],
      assumptions: [],
      confidence: 1
    };
    const rejected = validateQueryPlan(bad, schema);
    record("Query validation rejects $out", !rejected.ok, rejected.reasons.join("; "));

    const mock = new MockAIProvider((input) => {
      const q = input.question.toLowerCase();
      if (q.includes("revenue")) {
        return {
          status: "ready",
          operation: "aggregate",
          collection: "orders",
          pipeline: [
            { $match: { status: "completed" } },
            {
              $group: {
                _id: null,
                revenue: { $sum: { $multiply: ["$quantity", "$sellingPrice"] } }
              }
            }
          ],
          dateIntents: [{ field: "createdAt", range: "this_month" }],
          explanation: "Sum quantity * sellingPrice for completed orders this month",
          collectionsUsed: ["orders"],
          fieldsUsed: ["quantity", "sellingPrice", "createdAt", "status"],
          assumptions: ["Revenue is quantity * sellingPrice"],
          confidence: 0.9,
          visualization: { type: "metric", yField: "revenue" }
        };
      }
      return {
        status: "insufficient_data",
        operation: "find",
        collection: "orders",
        explanation: "I couldn't find a field or collection containing employee satisfaction data.",
        collectionsUsed: [],
        fieldsUsed: [],
        assumptions: [],
        confidence: 0.2
      };
    });

    const plan = await mock.generateQueryPlan({
      question: "How much revenue was generated this month?",
      schema: {
        database: schema.database,
        collections: schema.collections.map((c) => ({
          name: c.name,
          estimatedCount: c.estimatedCount,
          fields: Object.fromEntries(c.fields.map((f) => [f.path, f.type])),
          dateFields: c.fields.filter((f) => f.type === "date").map((f) => f.path),
          numericFields: c.fields.filter((f) => f.isNumeric).map((f) => f.path),
          possibleIdFields: c.fields.filter((f) => f.isPossibleId).map((f) => f.path)
        })),
        relationships: schema.relationships,
        note: "inferred"
      },
      dateContext: {},
      conversation: []
    });
    record("AI query planning (mock)", plan.status === "ready", plan.explanation);

    const validation = validateQueryPlan(plan, schema);
    record("Query validation", validation.ok, validation.ok ? "accepted" : validation.reasons.join("; "));

    const result = await executeQueryPlan(db, schema, validation.plan);
    const revenue = (result.documents[0] as { revenue?: number } | undefined)?.revenue;
    record(
      "MongoDB execution",
      result.success && typeof revenue === "number",
      `revenue=${String(revenue)} in ${result.executionTimeMs}ms`
    );

    const explanation = await mock.explainResult({
      question: "How much revenue was generated this month?",
      plan: validation.plan,
      result: result.documents,
      truncated: result.truncated
    });
    record(
      "Result explanation (mock)",
      explanation.answer.length > 0,
      explanation.answer
    );

    const writeAttempt = validateQueryPlan(
      {
        status: "ready",
        operation: "find",
        collection: "orders",
        filter: { $where: "this.quantity > 1" },
        explanation: "bad",
        collectionsUsed: ["orders"],
        fieldsUsed: [],
        assumptions: [],
        confidence: 1
      },
      schema
    );
    record("Reject $where", !writeAttempt.ok, writeAttempt.reasons.join("; "));
  } catch (error) {
    record("E2E pipeline", false, error instanceof Error ? error.message : "unknown error");
  } finally {
    await client.close().catch(() => undefined);
    if (stop) await stop();
  }

  const failed = steps.filter((s) => !s.ok);
  console.log("");
  console.log(`Passed: ${steps.length - failed.length}  Failed: ${failed.length}`);
  if (failed.length) {
    process.exitCode = 1;
  }
}

void main();
