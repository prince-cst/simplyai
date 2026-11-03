import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import {
  inferFieldsFromDocuments,
  buildDatabaseSchema,
  toCompactSchema
} from "../src/services/mongodb/SchemaInferenceService.js";

describe("schema inference", () => {
  it("infers nested and array paths", () => {
    const docs = [
      {
        _id: new ObjectId(),
        customer: { name: "A", address: { city: "Ahmedabad" } },
        items: [{ productId: new ObjectId(), quantity: 2 }],
        createdAt: new Date(),
        active: true
      }
    ];
    const fields = inferFieldsFromDocuments(docs);
    const paths = fields.map((f) => f.path);
    expect(paths).toContain("customer.name");
    expect(paths).toContain("customer.address.city");
    expect(paths).toContain("items[]");
    expect(paths).toContain("items[].productId");
    expect(paths).toContain("items[].quantity");
    expect(fields.find((f) => f.path === "createdAt")?.type).toBe("date");
    expect(fields.find((f) => f.path === "active")?.type).toBe("boolean");
  });

  it("detects possible relationships without assuming they are guaranteed", () => {
    const customerId = new ObjectId();
    const schema = buildDatabaseSchema("demo", [
      {
        name: "customers",
        estimatedCount: 2,
        sampleSize: 1,
        fields: inferFieldsFromDocuments([{ _id: customerId, name: "A" }]),
        sampleDocuments: [{ _id: customerId.toHexString(), name: "A" }]
      },
      {
        name: "orders",
        estimatedCount: 2,
        sampleSize: 1,
        fields: inferFieldsFromDocuments([{ _id: new ObjectId(), customerId, total: 10 }]),
        sampleDocuments: [{ _id: new ObjectId().toHexString(), customerId: customerId.toHexString(), total: 10 }]
      }
    ]);
    const rel = schema.relationships.find(
      (r) => r.fromCollection === "orders" && r.toCollection === "customers"
    );
    expect(rel).toBeTruthy();
    expect(rel?.reason.toLowerCase()).toContain("inferred");
    expect((rel?.confidence ?? 0) > 0.5).toBe(true);
  });

  it("marks mixed types", () => {
    const fields = inferFieldsFromDocuments([{ value: 1 }, { value: "x" }]);
    expect(fields.find((f) => f.path === "value")?.type).toBe("mixed");
  });

  it("keeps stringDateFields Mongo-only so MySQL/MSSQL planners are not affected", () => {
    const schema = buildDatabaseSchema("demo", [
      {
        name: "documents",
        estimatedCount: 1,
        sampleSize: 1,
        fields: [
          {
            path: "endDate",
            type: "string",
            typesSeen: ["string"],
            enumSamples: ["2026-09-01"],
            isPossibleId: false,
            isPossibleDate: true,
            isNumeric: false
          },
          {
            path: "createdAt",
            type: "date",
            typesSeen: ["date"],
            enumSamples: [],
            isPossibleId: false,
            isPossibleDate: true,
            isNumeric: false
          }
        ],
        sampleDocuments: [{ endDate: "2026-09-01" }]
      }
    ]);
    const mongo = toCompactSchema(schema, "mongodb");
    expect(mongo.collections[0].stringDateFields).toEqual(["endDate"]);
    expect(mongo.note.toLowerCase()).toContain("mongodb");

    const mysql = toCompactSchema(schema, "mysql");
    expect(mysql.collections[0].stringDateFields).toBeUndefined();
    expect(mysql.collections[0].dateFields).toEqual(["createdAt"]);
    expect(mysql.note.toLowerCase()).not.toContain("bson");

    const mssql = toCompactSchema(schema, "mssql");
    expect(mssql.collections[0].stringDateFields).toBeUndefined();
  });
});
