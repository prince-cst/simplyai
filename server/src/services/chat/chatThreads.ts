import { v4 as uuid } from "uuid";
import type { ChatThread, CompactChatTurn, QueryHistoryItem } from "../../types/index.js";
import type { SessionState } from "../session/SessionStore.js";

const MAX_THREADS = 40;
const TITLE_MAX = 48;

export function titleFromTurns(turns: CompactChatTurn[]): string {
  const q = turns.find((t) => t.role === "user")?.question?.trim();
  if (!q) return "New chat";
  return q.length > TITLE_MAX ? `${q.slice(0, TITLE_MAX - 1)}…` : q;
}

export function titleFromQuestion(question: string): string {
  const q = question.trim() || "New chat";
  return q.length > TITLE_MAX ? `${q.slice(0, TITLE_MAX - 1)}…` : q;
}

/** Ensure threads array exists; migrate legacy workspaces once. */
export function ensureThreads(session: SessionState): void {
  if (!session.threads) session.threads = [];

  if (session.threads.length > 0) {
    if (session.activeThreadId) {
      const active = session.threads.find((t) => t.id === session.activeThreadId);
      if (active && session.chatTurns.length === 0 && active.chatTurns.length > 0) {
        session.chatTurns = [...active.chatTurns];
      }
    }
    return;
  }

  // Migrate: active chatTurns → one thread
  if (session.chatTurns.length > 0) {
    const now = new Date().toISOString();
    const thread: ChatThread = {
      id: uuid(),
      title: titleFromTurns(session.chatTurns),
      createdAt: now,
      updatedAt: now,
      chatTurns: [...session.chatTurns]
    };
    session.threads = [thread];
    session.activeThreadId = thread.id;
    return;
  }

  // Migrate: flat query history → one recent per Q&A (newest first)
  if (session.queryHistory.length > 0) {
    session.threads = session.queryHistory.slice(0, MAX_THREADS).map((item) => threadFromHistoryItem(item));
  }
}

function threadFromHistoryItem(item: QueryHistoryItem): ChatThread {
  return {
    id: item.id,
    title: titleFromQuestion(item.question),
    createdAt: item.timestamp,
    updatedAt: item.timestamp,
    chatTurns: [
      { role: "user", question: item.question, historyId: item.id },
      {
        role: "assistant",
        answer: (item.answer ?? "").slice(0, 800),
        collectionsUsed: item.collectionsUsed,
        fieldsUsed: item.fieldsUsed.slice(0, 12),
        lastCollection: item.collectionsUsed[0],
        historyId: item.id
      }
    ]
  };
}

/** Keep active thread in sync after each turn. Creates thread on first message. */
export function syncActiveThread(session: SessionState): void {
  ensureThreads(session);
  if (session.chatTurns.length === 0) return;

  const now = new Date().toISOString();
  if (!session.activeThreadId) {
    const thread: ChatThread = {
      id: uuid(),
      title: titleFromTurns(session.chatTurns),
      createdAt: now,
      updatedAt: now,
      chatTurns: [...session.chatTurns]
    };
    session.threads.unshift(thread);
    session.activeThreadId = thread.id;
    session.threads = session.threads.slice(0, MAX_THREADS);
    return;
  }

  const idx = session.threads.findIndex((t) => t.id === session.activeThreadId);
  if (idx < 0) {
    session.activeThreadId = undefined;
    syncActiveThread(session);
    return;
  }

  const thread = session.threads[idx]!;
  thread.chatTurns = [...session.chatTurns];
  thread.updatedAt = now;
  if (!thread.title || thread.title === "New chat") {
    thread.title = titleFromTurns(session.chatTurns);
  }
  // Bump to top
  if (idx > 0) {
    session.threads.splice(idx, 1);
    session.threads.unshift(thread);
  }
}

/** Archive current thread (already in list via sync) and start blank. */
export function startNewChatThread(session: SessionState): void {
  ensureThreads(session);
  if (session.chatTurns.length > 0) {
    syncActiveThread(session);
  }
  session.chatTurns = [];
  session.pendingQuery = undefined;
  session.activeThreadId = undefined;
}

export function openChatThread(session: SessionState, threadId: string): boolean {
  ensureThreads(session);
  if (session.chatTurns.length > 0 && session.activeThreadId && session.activeThreadId !== threadId) {
    syncActiveThread(session);
  }
  const thread = session.threads.find((t) => t.id === threadId);
  if (!thread) return false;
  session.activeThreadId = thread.id;
  session.chatTurns = [...thread.chatTurns];
  session.pendingQuery = undefined;
  // Move to top
  session.threads = [thread, ...session.threads.filter((t) => t.id !== threadId)];
  return true;
}

export function deleteChatThread(session: SessionState, threadId: string): boolean {
  ensureThreads(session);
  const before = session.threads.length;
  session.threads = session.threads.filter((t) => t.id !== threadId);
  if (session.threads.length === before) return false;
  if (session.activeThreadId === threadId) {
    session.activeThreadId = undefined;
    session.chatTurns = [];
    session.pendingQuery = undefined;
  }
  return true;
}

export function threadsSummary(session: SessionState): Array<{
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  messageCount: number;
}> {
  ensureThreads(session);
  return session.threads.map((t) => ({
    id: t.id,
    title: t.title,
    updatedAt: t.updatedAt,
    createdAt: t.createdAt,
    messageCount: t.chatTurns.length
  }));
}
