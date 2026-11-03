import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AIProviderName, PublicSettings } from "@/types/api";

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => api<PublicSettings>("/settings")
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<PublicSettings>("/settings", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["settings"] });
    }
  });
}

export function useAiModels(provider: AIProviderName | undefined) {
  return useQuery({
    queryKey: ["ai", "models", provider],
    enabled: Boolean(provider),
    queryFn: () => api<{ models: { id: string; name: string }[] }>(`/ai/models?provider=${provider}`),
    retry: false
  });
}
