import { create } from "zustand";
import type { ChatResponse } from "@/types/api";

export interface ChatItem {
  id: string;
  role: "user" | "assistant";
  text: string;
  historyId?: string;
  restored?: boolean;
  data?: ChatResponse;
}

interface ChatState {
  messages: ChatItem[];
  setMessages: (messages: ChatItem[]) => void;
  append: (items: ChatItem | ChatItem[]) => void;
  remove: (id: string) => void;
  /** Keep messages through `id` inclusive; drop everything after. */
  truncateThrough: (id: string) => void;
  clear: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  setMessages: (messages) => set({ messages }),
  append: (items) =>
    set((s) => ({
      messages: [...s.messages, ...(Array.isArray(items) ? items : [items])]
    })),
  remove: (id) => set((s) => ({ messages: s.messages.filter((m) => m.id !== id) })),
  truncateThrough: (id) =>
    set((s) => {
      const idx = s.messages.findIndex((m) => m.id === id);
      if (idx < 0) return s;
      return { messages: s.messages.slice(0, idx + 1) };
    }),
  clear: () => set({ messages: [] })
}));
