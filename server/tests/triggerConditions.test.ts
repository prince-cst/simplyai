import { describe, expect, it } from "vitest";
import { TriggerWindowConditionSchema } from "../src/schemas/trigger.js";
import { formatRowsPreview } from "../src/services/triggers/triggerTemplates.js";

describe("trigger conditions", () => {
  it("accepts daysUntil", () => {
    const parsed = TriggerWindowConditionSchema.parse({
      kind: "daysUntil",
      minDays: 0,
      maxDays: 30
    });
    expect(parsed.kind).toBe("daysUntil");
  });

  it("accepts onOrBefore absolute cutoff", () => {
    const parsed = TriggerWindowConditionSchema.parse({
      kind: "onOrBefore",
      date: "2026-09-15"
    });
    expect(parsed).toEqual({ kind: "onOrBefore", date: "2026-09-15" });
  });

  it("accepts between range for will-expire windows", () => {
    const parsed = TriggerWindowConditionSchema.parse({
      kind: "between",
      fromDate: "2026-09-02",
      toDate: "2026-09-15"
    });
    expect(parsed.kind).toBe("between");
  });

  it("rejects invalid absolute date", () => {
    expect(() =>
      TriggerWindowConditionSchema.parse({ kind: "onOrBefore", date: "15 September" })
    ).toThrow();
  });

  it("rejects minDays > maxDays", () => {
    expect(() =>
      TriggerWindowConditionSchema.parse({
        kind: "daysUntil",
        minDays: 40,
        maxDays: 10
      })
    ).toThrow();
  });

  it("accepts newDocuments watch condition", () => {
    const parsed = TriggerWindowConditionSchema.parse({ kind: "newDocuments" });
    expect(parsed.kind).toBe("newDocuments");
  });
});

describe("formatRowsPreview", () => {
  it("formats readable document lines instead of dumping all fields", () => {
    const text = formatRowsPreview([
      {
        _id: "abc",
        name: "Shops ( Gumashta )",
        startDate: "2016-06-02",
        endDate: "2026-09-10",
        isDeleted: false,
        outletDocument: ["https://example.com/a.pdf", "https://example.com/b.pdf"],
        companyId: "685a2b387b34ce3610bf9037"
      }
    ]);
    expect(text).toContain("1. Shops ( Gumashta )");
    expect(text).toContain("endDate: 2026-09-10");
    expect(text).toContain("startDate: 2016-06-02");
    expect(text).not.toContain("isDeleted");
    expect(text).not.toContain("https://example.com");
    expect(text).not.toContain("outletDocument");
    expect(text).not.toContain("_id");
    expect(text).not.toContain("abc");
    expect(text).not.toContain("companyId");
  });

  it("includes every matching row in the email body", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      name: `Doc ${i + 1}`,
      endDate: "2026-09-10"
    }));
    const text = formatRowsPreview(rows);
    expect(text).toContain("1. Doc 1");
    expect(text).toContain("20. Doc 20");
    expect(text).not.toContain("more matching");
  });
});
