import { describe, expect, it } from "vitest";
import {
  parseMysqlUri,
  parseMysqlTarget,
  pickDefaultMysqlDatabase,
  toMysqlUri,
  looksLikeMysql
} from "../src/services/sql/mysqlUri.js";
import { validateSqlQueryPlan, stripSqlComments } from "../src/services/sql/SqlQueryValidator.js";
import { inheritedScopeFromConversation } from "../src/services/chat/followUpScope.js";
import type { DatabaseSchema, QueryPlan } from "../src/types/index.js";

const schema: DatabaseSchema = {
  database: "shop",
  collections: [
    {
      name: "sells",
      estimatedCount: 10,
      sampleSize: 1,
      fields: [
        {
          path: "amount",
          type: "number",
          typesSeen: ["number"],
          enumSamples: [],
          isPossibleId: false,
          isPossibleDate: false,
          isNumeric: true
        }
      ],
      sampleDocuments: []
    }
  ],
  relationships: [],
  introspectedAt: new Date().toISOString(),
  summary: {
    collectionCount: 1,
    estimatedDocuments: 10,
    relationshipCount: 0,
    dateFieldCount: 0,
    numericFieldCount: 1
  }
};

function plan(sql: string): QueryPlan {
  return {
    status: "ready",
    operation: "sql",
    collection: "sells",
    sql,
    explanation: "",
    collectionsUsed: ["sells"],
    fieldsUsed: ["amount"],
    assumptions: [],
    confidence: 1
  };
}

describe("MySQL URI and SQL safety", () => {
  it("parses jdbc mysql URIs", () => {
    const target = parseMysqlUri("jdbc:mysql://46.202.160.23:3306/shop?sslMode=preferred");
    expect(target.host).toBe("46.202.160.23");
    expect(target.port).toBe(3306);
    expect(target.database).toBe("shop");
    expect(target.ssl).toBe(true);
    expect(looksLikeMysql("jdbc:mysql://46.202.160.23")).toBe(true);
  });

  it("round-trips host form into a mysql URI", () => {
    const target = parseMysqlTarget({
      host: "46.202.160.23",
      port: 3306,
      username: "root",
      password: "secret",
      databaseName: "shop",
      ssl: true
    });
    const uri = toMysqlUri(target);
    expect(uri).toContain("mysql://");
    expect(parseMysqlUri(uri).password).toBe("secret");
  });

  it("allows a single SELECT and rejects writes", () => {
    expect(validateSqlQueryPlan(plan("SELECT amount FROM sells LIMIT 10"), schema).ok).toBe(true);
    expect(validateSqlQueryPlan(plan("DELETE FROM sells"), schema).ok).toBe(false);
    expect(validateSqlQueryPlan(plan("SELECT 1; DROP TABLE sells"), schema).ok).toBe(false);
    expect(stripSqlComments("SELECT 1 /* INSERT */")).toContain("SELECT 1");
  });

  it("picks a MySQL database from the connection name without guessing among unrelated schemas", () => {
    expect(pickDefaultMysqlDatabase("OLD simply trade", ["analytics", "simply_trade", "other"])).toBe("simply_trade");
    expect(pickDefaultMysqlDatabase("shop", ["shop"])).toBe("shop");
    expect(pickDefaultMysqlDatabase("OLD simply trade", ["alpha", "beta"])).toBeUndefined();
  });

  it("keeps the previous answer as inherited follow-up scope", () => {
    const scope = inheritedScopeFromConversation([
      { role: "user", question: "which month was profitable most" },
      {
        role: "assistant",
        answer: "July 2026 with profit 50000",
        focus: "July 2026 with profit 50000",
        lastCollection: "sells",
        dateIntents: [{ field: "createdAt", range: "july" }]
      }
    ]);
    expect(scope).toContain("July 2026");
    expect(scope).toContain("july");
  });
});
