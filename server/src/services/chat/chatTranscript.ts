import type { CompactChatTurn, QueryHistoryItem } from "../../types/index.js";
import type { SessionState } from "../session/SessionStore.js";

/** Rebuild planner follow-up context from query history when chatTurns were lost. */
export function queryHistoryToChatTurns(history: QueryHistoryItem[]): CompactChatTurn[] {
  return [...history].reverse().flatMap((item) => [
    {
      role: "user" as const,
      question: item.question,
      historyId: item.id
    },
    {
      role: "assistant" as const,
      answer: (item.answer ?? "").slice(0, 800),
      collectionsUsed: item.collectionsUsed,
      fieldsUsed: item.fieldsUsed.slice(0, 12),
      lastCollection: item.collectionsUsed[0],
      focus: item.focus || item.answer?.slice(0, 280),
      historyId: item.id
    }
  ]);
}

export function ensureChatTurnsFromHistory(session: SessionState): void {
  if (session.chatTurns.length > 0 || session.queryHistory.length === 0) {
    return;
  }
  session.chatTurns = queryHistoryToChatTurns(session.queryHistory).slice(-40);
}
