import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { resetClientChat, switchClientWorkspace } from "@/hooks/useHistory";
import type { CollectionSchema, ConnectionStatus, DatabaseSchema } from "@/types/api";

export function useMongoStatus() {
  return useQuery({
    queryKey: ["mongo", "status"],
    queryFn: () => api<ConnectionStatus>("/mongodb/status"),
    refetchInterval: 15000
  });
}

export function useSchema(compact = false) {
  return useQuery({
    queryKey: ["mongo", "schema", compact],
    queryFn: () => api<{ introspectedAt?: string; schema: DatabaseSchema }>("/mongodb/schema?compact=" + compact),
    retry: false
  });
}

export function useCollections() {
  return useQuery({
    queryKey: ["mongo", "collections"],
    queryFn: () =>
      api<{ database: string; collections: { name: string; estimatedCount: number; fieldCount: number }[] }>(
        "/mongodb/collections"
      ),
    retry: false
  });
}

export function useCollection(name: string | undefined) {
  return useQuery({
    queryKey: ["mongo", "collection", name],
    enabled: Boolean(name),
    queryFn: () => api<{ database: string; collection: CollectionSchema }>(`/mongodb/collections/${name}`)
  });
}

export function useConnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      engine?: "mongodb" | "mysql" | "mssql";
      connectionString?: string;
      host?: string;
      port?: number;
      username?: string;
      password?: string;
      ssl?: boolean;
      databaseName?: string;
      name?: string;
    }) => api<ConnectionStatus>("/mongodb/connect", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      switchClientWorkspace(qc);
    }
  });
}

export function useDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body?: { connectionId?: string; forget?: boolean }) =>
      api<ConnectionStatus>("/mongodb/disconnect", { method: "POST", body: JSON.stringify(body ?? {}) }),
    onSuccess: () => {
      resetClientChat(qc);
      void qc.invalidateQueries();
    }
  });
}

export function useActivateConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (connectionId: string) =>
      api<ConnectionStatus>("/mongodb/activate", { method: "POST", body: JSON.stringify({ connectionId }) }),
    onSuccess: () => {
      switchClientWorkspace(qc);
    }
  });
}

export function useAddDatabase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { databaseName: string; name?: string }) =>
      api<ConnectionStatus>("/mongodb/databases/add", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      switchClientWorkspace(qc);
    }
  });
}

export function useRefreshSchema() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("/mongodb/refresh-schema", { method: "POST" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["mongo"] });
    }
  });
}

export function useSelectDatabase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (databaseName: string) =>
      api("/mongodb/select-database", { method: "POST", body: JSON.stringify({ databaseName }) }),
    onSuccess: () => {
      switchClientWorkspace(qc);
    }
  });
}

export function useSample(collection: string | undefined, limit = 10) {
  return useQuery({
    queryKey: ["mongo", "sample", collection, limit],
    enabled: Boolean(collection),
    queryFn: () =>
      api<{ collection: string; documents: Record<string, unknown>[] }>(
        `/mongodb/collections/${collection}/sample?limit=${limit}`
      )
  });
}
