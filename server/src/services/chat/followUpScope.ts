import type { CompactChatTurn } from "../../types/index.js";

export function inheritedScopeFromConversation(conversation: CompactChatTurn[]): string {
  const last = [...conversation].reverse().find((turn) => turn.role === "assistant" && (turn.focus || turn.answer));
  if (!last) return "";
  return [
    last.focus || last.answer,
    last.dateIntents?.length ? `dateIntents: ${JSON.stringify(last.dateIntents)}` : "",
    last.lastCollection ? `primary table/collection: ${last.lastCollection}` : "",
    last.collectionsUsed?.length ? `tables/collections: ${last.collectionsUsed.join(", ")}` : "",
    last.sql ? `previous SQL: ${last.sql}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

export function lastAssistantAnswer(conversation: CompactChatTurn[]): string | undefined {
  return [...conversation].reverse().find((turn) => turn.role === "assistant" && turn.answer)?.answer;
}

export function focusFromAnswer(answer: string, extras: string[] = []): string {
  return [answer.slice(0, 280), ...extras.filter(Boolean)].join("\n");
}
