import { describe, expect, it } from "vitest";
import { hydrateDatesAndIds, reviveMongoValue } from "../src/utils/bson.js";

describe("bson hydration", () => {
  it("preserves Date instances already in the query", () => {
    const start = new Date("2026-08-01T00:00:00.000Z");
    const filter = { createdAt: { $gte: start } };
    const out = hydrateDatesAndIds(filter, new Set(["createdAt"]), new Set(["_id"])) as {
      createdAt: { $gte: Date };
    };
    expect(out.createdAt.$gte).toBeInstanceOf(Date);
    expect(out.createdAt.$gte.toISOString()).toBe(start.toISOString());
  });

  it("revives extended JSON dates and object ids", () => {
    const revived = reviveMongoValue({
      _id: { $oid: "64b1f2c3d4e5f60718293a4b" },
      createdAt: { $date: "2026-08-01T00:00:00.000Z" }
    }) as { _id: { toHexString: () => string }; createdAt: Date };
    expect(revived.createdAt).toBeInstanceOf(Date);
    expect(revived._id.toHexString()).toBe("64b1f2c3d4e5f60718293a4b");
  });
});
