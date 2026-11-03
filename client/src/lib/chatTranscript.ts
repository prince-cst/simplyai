import type { ChatResponse, CompactChatTurn, QueryHistoryItem } from "@/types/api";
import type { ChatItem } from "@/stores/chatStore";

export function messagesFromSession(history: QueryHistoryItem[], chat: CompactChatTurn[]): ChatItem[] {
  // Only restore the active chat thread. Query history stays on the History page.
  if (chat.length > 0) {
    return messagesFromChatTurns(chat, history);
  }
  return [];
}

export function messagesFromQueryHistory(history: QueryHistoryItem[]): ChatItem[] {
  return [...history].reverse().flatMap((item) => pairFromHistory(item));
}

export function messagesFromChatTurns(chat: CompactChatTurn[], history: QueryHistoryItem[]): ChatItem[] {
  const unused = [...history].reverse();
  const items: ChatItem[] = [];
  let lastHistory: QueryHistoryItem | undefined;

  for (const turn of chat) {
    if (turn.role === "user") {
      const question = turn.question ?? "";
      const idx = unused.findIndex((h) => h.id === turn.historyId || h.question === question);
      lastHistory = idx >= 0 ? unused.splice(idx, 1)[0] : undefined;
      const historyId = turn.historyId ?? lastHistory?.id;
      items.push({
        id: historyId ? `u-${historyId}` : `u-${items.length}`,
        role: "user",
        text: question,
        historyId
      });
      continue;
    }

    const historyId = turn.historyId ?? lastHistory?.id;
    const text = lastHistory?.answer || turn.answer || "";
    items.push({
      id: historyId ? `a-${historyId}` : `a-${items.length}`,
      role: "assistant",
      text,
      historyId,
      restored: true,
      data: restoredResponse(lastHistory, turn, lastHistory?.question ?? "")
    });
  }

  return items;
}

function pairFromHistory(item: QueryHistoryItem): ChatItem[] {
  return [
    {
      id: `u-${item.id}`,
      role: "user",
      text: item.question,
      historyId: item.id
    },
    {
      id: `a-${item.id}`,
      role: "assistant",
      text: item.answer || "No answer stored for this turn.",
      historyId: item.id,
      restored: true,
      data: restoredResponse(item)
    }
  ];
}

function restoredResponse(
  item?: QueryHistoryItem,
  turn?: CompactChatTurn,
  fallbackQuestion = ""
): ChatResponse {
  const answer = item?.answer || turn?.answer || "";
  const status = restoreStatus(item);
  return {
    status,
    question: item?.question ?? fallbackQuestion,
    answer,
    provider: item?.provider ?? "ollama",
    model: item?.model ?? "",
    usedFallback: false,
    canFallback: false,
    explanation: {
      answer,
      summary: "",
      fieldsUsed: item?.fieldsUsed ?? turn?.fieldsUsed ?? [],
      collectionsUsed: item?.collectionsUsed ?? turn?.collectionsUsed ?? [],
      assumptions: [],
      warnings: ["Restored from this session. Result tables are shown for new questions."],
      insufficientData: status === "insufficient_data"
    }
  };
}

function restoreStatus(item?: QueryHistoryItem): ChatResponse["status"] {
  if (item?.status === "needs_clarification") return "needs_clarification";
  if (item?.status === "insufficient_data" || item?.success === false) return "insufficient_data";
  return "answered";
}
