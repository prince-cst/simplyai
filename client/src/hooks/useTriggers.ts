import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { TriggerDefinition, TriggerProposal } from "@/types/api";

export function useTriggers() {
  return useQuery({
    queryKey: ["triggers"],
    queryFn: () =>
      api<{
        triggers: TriggerDefinition[];
        smtpConfigured: boolean;
        activeConnectionId?: string | null;
      }>("/triggers")
  });
}

export function useProposeTrigger() {
  return useMutation({
    mutationFn: (body: { prompt: string; connectionId?: string }) =>
      api<{ proposal: TriggerProposal; provider: string; model: string }>("/triggers/propose", {
        method: "POST",
        body: JSON.stringify(body)
      })
  });
}

export function useCreateTrigger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Omit<TriggerProposal, "connectionId"> & {
      connectionId?: string;
      status?: TriggerDefinition["status"];
    }) =>
      api<{ trigger: TriggerDefinition }>("/triggers", {
        method: "POST",
        body: JSON.stringify(body)
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["triggers"] })
  });
}

export function usePatchTrigger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: Partial<TriggerDefinition> & { id: string }) =>
      api<{ trigger: TriggerDefinition }>(`/triggers/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body)
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["triggers"] })
  });
}

export function useApproveTrigger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ trigger: TriggerDefinition }>(`/triggers/${id}/approve`, { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["triggers"] })
  });
}

export function useDeleteTrigger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: boolean }>(`/triggers/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["triggers"] })
  });
}

export function useTestTrigger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      windowId,
      sendEmail
    }: {
      id: string;
      windowId?: string;
      sendEmail?: boolean;
    }) =>
      api<{ trigger: TriggerDefinition; run: TriggerDefinition["recentRuns"][number] }>(
        `/triggers/${id}/test`,
        {
          method: "POST",
          body: JSON.stringify({ windowId, sendEmail, dryRun: !sendEmail })
        }
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["triggers"] })
  });
}
