import { describe, expect, it } from "vitest";
import { ensureChatTurnsFromHistory, queryHistoryToChatTurns } from "../src/services/chat/chatTranscript.js";
import type { SessionState } from "../src/services/session/SessionStore.js";
import type { QueryHistoryItem } from "../src/types/index.js";

function historyItem(partial: Partial<QueryHistoryItem> & Pick<QueryHistoryItem, "id" | "question">): QueryHistoryItem {
  return {
    timestamp: "2026-08-25T10:00:00.000Z",
    provider: "ollama",
    model: "qwen2.5-coder:7b",
    collectionsUsed: ["orders"],
    fieldsUsed: ["createdAt"],
    executionTimeMs: 12,
    success: true,
    status: "ready",
    answer: `Answer for ${partial.question}`,
    ...partial
  };
}

describe("chat transcript", () => {
  it("rebuilds chronological turns from newest-first history", () => {
    const turns = queryHistoryToChatTurns([
      historyItem({ id: "newer", question: "How many last month?" }),
      historyItem({ id: "older", question: "How many orders?" })
    ]);
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(turns[0]?.question).toBe("How many orders?");
    expect(turns[0]?.historyId).toBe("older");
    expect(turns[2]?.question).toBe("How many last month?");
  });

  it("fills empty chatTurns from query history", () => {
    const session = {
      id: "s1",
      createdAt: "2026-08-25T10:00:00.000Z",
      chatTurns: [],
      queryHistory: [historyItem({ id: "h1", question: "How many orders?" })]
    } as SessionState;
    ensureChatTurnsFromHistory(session);
    expect(session.chatTurns).toHaveLength(2);
    expect(session.chatTurns[0]?.question).toBe("How many orders?");
  });

  it("does not overwrite existing chatTurns", () => {
    const session = {
      id: "s1",
      createdAt: "2026-08-25T10:00:00.000Z",
      chatTurns: [{ role: "user", question: "keep me" }],
      queryHistory: [historyItem({ id: "h1", question: "How many orders?" })]
    } as SessionState;
    ensureChatTurnsFromHistory(session);
    expect(session.chatTurns).toHaveLength(1);
    expect(session.chatTurns[0]?.question).toBe("keep me");
  });
});
