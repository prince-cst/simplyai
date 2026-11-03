import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  configureAppStore,
  emptyAppStore,
  getAppStore,
  loadAppStore,
  persistWorkspace,
  setSavedConnections
} from "../src/config/appStore.js";

describe("project app store", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mba-store-"));
  const filePath = path.join(dir, "app-store.json");

  afterEach(() => {
    configureAppStore({ persist: false, snapshot: emptyAppStore() });
  });

  it("saves connections and chat workspaces to disk", () => {
    configureAppStore({ persist: true, filePath, snapshot: emptyAppStore() });
    setSavedConnections(
      [
        {
          id: "c1",
          name: "Shop",
          uri: "mongodb://127.0.0.1:27017/shop",
          databaseName: "shop",
          createdAt: "2026-08-25T10:00:00.000Z",
          lastUsedAt: "2026-08-25T10:00:00.000Z"
        }
      ],
      "c1"
    );
    persistWorkspace("c1", {
      chatTurns: [{ role: "user", question: "How many orders?" }],
      queryHistory: []
    });
    configureAppStore({ persist: true, filePath });
    const reloaded = loadAppStore();
    expect(reloaded.activeConnectionId).toBe("c1");
    expect(reloaded.connections[0]?.name).toBe("Shop");
    expect(getAppStore().chats.c1?.chatTurns[0]?.question).toBe("How many orders?");
  });
});
