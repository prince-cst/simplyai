import { describe, expect, it } from "vitest";
import {
  resolveDateRange,
  getZonedParts,
  zonedDateTimeToUtc,
  bsonDateFilter,
  resolveDateBoundStorage,
  formatDateOnlyBound
} from "../src/utils/dates.js";
import { applyDateIntents } from "../src/services/mongodb/QueryExecutionService.js";
import type { DatabaseSchema, QueryPlan } from "../src/types/index.js";

describe("date utilities", () => {
  it("resolves this_month in Asia/Kolkata", () => {
    const now = new Date("2026-08-25T06:30:00.000Z");
    const range = resolveDateRange("this_month", "Asia/Kolkata", now);
    expect(range.start < range.end).toBe(true);
    const startParts = getZonedParts(range.start, "Asia/Kolkata");
    expect(startParts.year).toBe(2026);
    expect(startParts.month).toBe(8);
    expect(startParts.day).toBe(1);
    expect(startParts.hour).toBe(0);
    const endParts = getZonedParts(range.end, "Asia/Kolkata");
    expect(endParts.month).toBe(9);
    expect(endParts.day).toBe(1);
  });

  it("resolves last_month before this_month", () => {
    const now = new Date("2026-08-25T06:30:00.000Z");
    const last = resolveDateRange("last_month", "Asia/Kolkata", now);
    const current = resolveDateRange("this_month", "Asia/Kolkata", now);
    expect(last.end.getTime()).toBe(current.start.getTime());
  });

  it("converts zoned midnight to UTC", () => {
    const utc = zonedDateTimeToUtc(2026, 8, 25, 0, 0, 0, "Asia/Kolkata");
    expect(utc.toISOString()).toBe("2026-08-24T18:30:00.000Z");
  });

  it("resolves today as a single local day", () => {
    const now = new Date("2026-08-25T18:00:00.000Z");
    const range = resolveDateRange("today", "Asia/Kolkata", now);
    expect(range.end.getTime() - range.start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("formats date-only string bounds for string-stored fields", () => {
    const now = new Date("2026-09-02T10:00:00.000Z");
    const range = resolveDateRange("this_month", "Asia/Kolkata", now);
    const filter = bsonDateFilter(range, "dateString", "Asia/Kolkata");
    expect(filter).toEqual({ $gte: "2026-09-01", $lt: "2026-10-01" });
    expect(formatDateOnlyBound(range.start, "Asia/Kolkata")).toBe("2026-09-01");
  });

  it("detects dateString storage from YYYY-MM-DD samples", () => {
    expect(
      resolveDateBoundStorage({
        fieldType: "string",
        isPossibleDate: true,
        sampleValues: ["2021-12-31", "2025-09-21"]
      })
    ).toBe("dateString");
  });

  it("detects bsonDate storage from Date samples", () => {
    expect(
      resolveDateBoundStorage({
        fieldType: "date",
        sampleValues: [new Date("2026-01-01")]
      })
    ).toBe("bsonDate");
  });
});

describe("applyDateIntents", () => {
  const schema: DatabaseSchema = {
    database: "test",
    introspectedAt: new Date().toISOString(),
    relationships: [],
    summary: {
      collectionCount: 1,
      estimatedDocuments: 10,
      relationshipCount: 0,
      dateFieldCount: 0,
      numericFieldCount: 0
    },
    collections: [
      {
        name: "documents",
        estimatedCount: 10,
        sampleSize: 2,
        sampleDocuments: [
          { endDate: "2021-12-31", isDeleted: false },
          { endDate: "2026-09-15", isDeleted: false }
        ],
        fields: [
          {
            path: "endDate",
            type: "string",
            typesSeen: ["string"],
            enumSamples: ["2021-12-31"],
            isPossibleId: false,
            isPossibleDate: true,
            isNumeric: false
          },
          {
            path: "isDeleted",
            type: "boolean",
            typesSeen: ["boolean"],
            enumSamples: [],
            isPossibleId: false,
            isPossibleDate: false,
            isNumeric: false
          }
        ]
      }
    ]
  };

  it("injects YYYY-MM-DD string bounds into aggregate $match for string date fields", () => {
    const plan: QueryPlan = {
      status: "ready",
      operation: "aggregate",
      collection: "documents",
      pipeline: [{ $match: { isDeleted: { $ne: true } } }, { $count: "expiredCount" }],
      dateIntents: [{ field: "endDate", range: "this_month" }],
      explanation: "count",
      collectionsUsed: ["documents"],
      fieldsUsed: ["endDate", "isDeleted"],
      assumptions: [],
      confidence: 1
    };
    const applied = applyDateIntents(plan, "Asia/Kolkata", schema);
    const match = applied.pipeline?.[0]?.$match as Record<string, unknown>;
    expect(match.isDeleted).toEqual({ $ne: true });
    const expected = bsonDateFilter(
      resolveDateRange("this_month", "Asia/Kolkata"),
      "dateString",
      "Asia/Kolkata"
    );
    expect(match.endDate).toEqual(expected);
  });
});
