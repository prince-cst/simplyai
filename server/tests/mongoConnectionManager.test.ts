import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoConnectionManager } from "../src/services/mongodb/MongoConnectionManager.js";
import { maskConnectionString, extractDatabaseName } from "../src/utils/mask.js";

describe("MongoDB connection manager", () => {
  let mem: MongoMemoryServer;
  let uri: string;
  const manager = new MongoConnectionManager({ persist: false });

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    uri = mem.getUri();
  });

  afterAll(async () => {
    await manager.disconnect("test-session", undefined, true);
    await manager.disconnect("multi-session", undefined, true);
    await mem.stop();
  });

  it("masks passwords in connection strings", () => {
    expect(maskConnectionString("mongodb+srv://user:secret@cluster.mongodb.net/shopdb")).toBe(
      "mongodb+srv://user:********@cluster.mongodb.net/shopdb"
    );
  });

  it("extracts database name from URI", () => {
    expect(extractDatabaseName("mongodb://localhost:27017/shopdb")).toBe("shopdb");
    expect(extractDatabaseName("mongodb+srv://u:p@host/mydb?retryWrites=true")).toBe("mydb");
  });

  it("connects, lists collections, and disconnects", async () => {
    const status = await manager.connect("test-session", uri, "demo");
    expect(status.connected).toBe(true);
    expect(status.database).toBe("demo");
    expect(status.maskedUri?.includes("secret")).toBeFalsy();
    const db = manager.getDb("test-session");
    await db.collection("items").insertOne({ n: 1 });
    const names = await db.listCollections().toArray();
    expect(names.some((c) => c.name === "items")).toBe(true);
    await manager.disconnect("test-session", undefined, true);
    expect(manager.isConnected("test-session")).toBe(false);
  });

  it("keeps two databases and switches the active one", async () => {
    const status1 = await manager.connect("multi-session", uri, "alpha", "Alpha");
    const status2 = await manager.connect("multi-session", uri, "beta", "Beta");
    expect(status1.connected).toBe(true);
    expect(status2.database).toBe("beta");
    expect(manager.publicConnections()).toHaveLength(2);
    expect(manager.getDb("multi-session").databaseName).toBe("beta");
    const first = manager.publicConnections().find((c) => c.databaseName === "alpha");
    expect(first).toBeTruthy();
    await manager.activate("multi-session", first!.id);
    expect(manager.getDb("multi-session").databaseName).toBe("alpha");
    await manager.disconnect("multi-session", undefined, true);
    await manager.disconnect("multi-session", undefined, true);
  });
});
