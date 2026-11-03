import { toast } from "sonner";
import { Select } from "@/components/ui";
import { useActivateConnection, useMongoStatus } from "@/hooks/useMongo";
import { engineLabel, isExternalAppEngine, isOutlookEngine, isQuickBooksEngine } from "@/lib/engines";
import { ApiError } from "@/types/api";
import { cn } from "@/lib/utils";

/** Global header picker: databases and OAuth apps as separate groups. */
export function EntitySwitcher({ compact = false }: { compact?: boolean }) {
  const status = useMongoStatus();
  const activate = useActivateConnection();
  const connections = status.data?.connections ?? [];
  const activeId = status.data?.activeConnectionId ?? "";

  if (!connections.length) {
    return (
      <p className={cn("text-xs text-slate-500", compact && "hidden sm:block")}>
        No data source connected
      </p>
    );
  }

  const databases = connections.filter((c) => !isExternalAppEngine(c.engine));
  const qbAccounts = connections.filter((c) => isQuickBooksEngine(c.engine));
  const outlookAccounts = connections.filter((c) => isOutlookEngine(c.engine));

  return (
    <label className={cn("flex items-center gap-2 text-sm", compact ? "min-w-0" : "min-w-[14rem]")}>
      <span className="hidden shrink-0 text-xs font-medium text-slate-500 sm:inline">Chat with</span>
      <Select
        className={cn(compact ? "h-8 min-w-[10rem] max-w-[18rem] py-1 text-xs" : "")}
        value={activeId}
        disabled={activate.isPending}
        onChange={(e) => {
          const id = e.target.value;
          if (!id || id === activeId) return;
          activate.mutate(id, {
            onSuccess: (data) =>
              toast.success(`Now chatting with ${data.connectionName ?? data.database}`),
            onError: (err) =>
              toast.error(err instanceof ApiError ? err.message : "Could not switch source")
          });
        }}
      >
        {databases.length ? (
          <optgroup label="Databases">
            {databases.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {` · ${engineLabel(item.engine)}`}
                {item.databaseName && item.databaseName !== item.name ? ` (${item.databaseName})` : ""}
                {item.connected ? "" : " — reconnect"}
              </option>
            ))}
          </optgroup>
        ) : null}
        {qbAccounts.length ? (
          <optgroup label="QuickBooks">
            {qbAccounts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.connected ? "" : " — reconnect"}
              </option>
            ))}
          </optgroup>
        ) : null}
        {outlookAccounts.length ? (
          <optgroup label="Outlook">
            {outlookAccounts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.connected ? "" : " — reconnect"}
              </option>
            ))}
          </optgroup>
        ) : null}
      </Select>
    </label>
  );
}
