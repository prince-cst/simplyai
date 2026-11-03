import { toast } from "sonner";
import { Select } from "@/components/ui";
import { useActivateConnection, useMongoStatus } from "@/hooks/useMongo";
import { engineLabel } from "@/lib/engines";
import { ApiError } from "@/types/api";

export function ChatDbSwitcher() {
  const status = useMongoStatus();
  const activate = useActivateConnection();
  const connections = status.data?.connections ?? [];
  const activeId = status.data?.activeConnectionId ?? "";

  if (!connections.length) return null;

  return (
    <label className="flex min-w-[16rem] max-w-md flex-col gap-1 text-sm">
      <span className="text-xs font-medium text-slate-500">Chat with database</span>
      <Select
        value={activeId}
        disabled={activate.isPending}
        onChange={(e) => {
          const id = e.target.value;
          if (!id || id === activeId) return;
          activate.mutate(id, {
            onSuccess: (data) => toast.success(`Now chatting with ${data.connectionName ?? data.database}`),
            onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not switch database")
          });
        }}
      >
        {connections.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
            {` [${engineLabel(item.engine)}]`}
            {item.databaseName && item.databaseName !== item.name ? ` (${item.databaseName})` : ""}
            {item.connected ? "" : " — reconnect"}
          </option>
        ))}
      </Select>
    </label>
  );
}
