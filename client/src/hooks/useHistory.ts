import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useChatStore } from "@/stores/chatStore";
import { messagesFromSession } from "@/lib/chatTranscript";
import type { SessionHistoryResponse } from "@/types/api";

export function resetClientChat(qc: QueryClient): void {
  useChatStore.getState().clear();
  qc.removeQueries({ queryKey: ["history"] });
}

export function switchClientWorkspace(qc: QueryClient): void {
  useChatStore.getState().clear();
  qc.removeQueries({ queryKey: ["history"] });
  void qc.invalidateQueries();
}

export function useSessionHistory() {
  return useQuery({
    queryKey: ["history"],
    queryFn: () => api<SessionHistoryResponse>("/history")
  });
}

function applyHistory(qc: QueryClient, data: SessionHistoryResponse): void {
  qc.setQueryData(["history"], data);
  useChatStore.getState().setMessages(messagesFromSession(data.history, data.chat));
}

/** Clear active chat thread only — Recents are preserved. */
export function useNewChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<SessionHistoryResponse & { ok: boolean }>("/history/new", { method: "POST" }),
    onSuccess: (data) => {
      applyHistory(qc, data);
    }
  });
}

/** Open a saved recent conversation. */
export function useOpenThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<SessionHistoryResponse & { ok: boolean }>(`/history/threads/${encodeURIComponent(id)}`, {
        method: "POST"
      }),
    onSuccess: (data) => {
      applyHistory(qc, data);
    }
  });
}

/** Delete a recent conversation. */
export function useDeleteThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<SessionHistoryResponse & { ok: boolean }>(`/history/threads/${encodeURIComponent(id)}`, {
        method: "DELETE"
      }),
    onSuccess: (data) => {
      applyHistory(qc, data);
    }
  });
}

/** Rebuild chat thread from query history (legacy). */
export function useResumeChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<SessionHistoryResponse & { ok: boolean }>("/history/resume", { method: "POST" }),
    onSuccess: (data) => {
      applyHistory(qc, data);
      void qc.invalidateQueries({ queryKey: ["history"] });
    }
  });
}

/** Wipe both chat thread and Recents. */
export function useClearHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("/history", { method: "DELETE" }),
    onSuccess: () => {
      resetClientChat(qc);
      void qc.invalidateQueries({ queryKey: ["history"] });
    }
  });
}
