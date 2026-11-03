import type { Request, Response } from "express";
import { createAIProvider } from "../services/ai/AIProviderFactory.js";
import { getRuntimeSettings } from "../config/runtimeSettings.js";
import { mongoConnectionManager } from "../services/mongodb/MongoConnectionManager.js";
import { refreshSchema } from "../services/schemaRefresh.js";
import { getOrCreateSession } from "../services/session/SessionStore.js";
import { executeQueryPlan } from "../services/mongodb/QueryExecutionService.js";
import type { AIProviderName, QueryPlan } from "../types/index.js";

interface TestResult {
  name: string;
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
}

async function wrap(name: string, fn: () => Promise<TestResult>): Promise<TestResult> {
  try {
    return await fn();
  } catch (error) {
    return {
      name,
      ok: false,
      message: error instanceof Error ? error.message : "Failed"
    };
  }
}

export async function runTestCenter(req: Request, res: Response): Promise<void> {
  const which = String(req.query.which || req.body?.which || "all");
  const results: TestResult[] = [];

  if (which === "all" || which === "mongodb") {
    results.push(
      await wrap("MongoDB connection", async () => {
        const status = mongoConnectionManager.getStatus(req.sessionId);
        if (!status.connected) {
          return {
            name: "MongoDB connection",
            ok: false,
            message: "Not connected. Demo mode available.\n\nRun:\nnpm run seed:test"
          };
        }
        return {
          name: "MongoDB connection",
          ok: true,
          message: `MongoDB connection successful\n\nDatabase:\n${status.database ?? "(none)"}\n\nCollections discovered:\n${status.collectionCount ?? 0}`,
          details: { ...status, maskedUri: status.maskedUri }
        };
      })
    );
  }

  if (which === "all" || which === "schema") {
    results.push(
      await wrap("Schema introspection", async () => {
        const schema = await refreshSchema(req.sessionId);
        return {
          name: "Schema introspection",
          ok: true,
          message: `Schema inspection: Successful\nCollections: ${schema.summary.collectionCount}`,
          details: { summary: schema.summary, introspectedAt: schema.introspectedAt }
        };
      })
    );
  }

  for (const provider of ["ollama", "gemini", "groq"] as AIProviderName[]) {
    if (which === "all" || which === provider || which === "ai") {
      results.push(
        await wrap(`Test ${provider}`, async () => {
          const p = createAIProvider(getRuntimeSettings(), provider);
          const test = await p.testConnection();
          return {
            name: `Test ${provider}`,
            ok: test.ok,
            message: test.message,
            details: { latencyMs: test.latencyMs, model: test.model, ...test.details }
          };
        })
      );
    }
  }

  if (which === "all" || which === "simple-ai") {
    results.push(
      await wrap("Simple AI query", async () => {
        const p = createAIProvider();
        const test = await p.completeSimpleTest();
        return {
          name: "Simple AI query",
          ok: test.ok,
          message: test.text,
          details: { latencyMs: test.latencyMs, model: p.model, provider: p.name }
        };
      })
    );
  }

  if (which === "all" || which === "query") {
    results.push(
      await wrap("MongoDB query execution", async () => {
        const session = getOrCreateSession(req.sessionId);
        if (!session.schema) {
          return { name: "MongoDB query execution", ok: false, message: "No schema loaded" };
        }
        const first = session.schema.collections[0];
        if (!first) {
          return { name: "MongoDB query execution", ok: false, message: "No collections" };
        }
        const plan: QueryPlan = {
          status: "ready",
          operation: "count",
          collection: first.name,
          explanation: "Test count",
          collectionsUsed: [first.name],
          fieldsUsed: ["_id"],
          assumptions: [],
          confidence: 1
        };
        const db = mongoConnectionManager.getDb(req.sessionId);
        const result = await executeQueryPlan(db, session.schema, plan);
        return {
          name: "MongoDB query execution",
          ok: result.success,
          message: `Counted documents in ${first.name}: ${JSON.stringify(result.documents)}`,
          details: { executionTimeMs: result.executionTimeMs, collection: first.name }
        };
      })
    );
  }

  res.json({
    results,
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length
  });
}
