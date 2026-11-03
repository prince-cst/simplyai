import { toast } from "sonner";
import { RefreshCw, Trash2, Unplug } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import {
  useActivateConnection,
  useAddDatabase,
  useDisconnect,
  useMongoStatus,
  useRefreshSchema,
  useSelectDatabase
} from "@/hooks/useMongo";
import { engineLabel, isExternalAppEngine, isOutlookEngine, isQuickBooksEngine } from "@/lib/engines";
import { ApiError } from "@/types/api";

export function ConnectionStatus() {
  const status = useMongoStatus();
  const disconnect = useDisconnect();
  const refresh = useRefreshSchema();
  const selectDb = useSelectDatabase();
  const activate = useActivateConnection();
  const addDb = useAddDatabase();
  const data = status.data;
  const connections = data?.connections ?? [];
  const databases = connections.filter((c) => !isExternalAppEngine(c.engine));
  const qbAccounts = connections.filter((c) => isQuickBooksEngine(c.engine));
  const outlookAccounts = connections.filter((c) => isOutlookEngine(c.engine));
  const extraDbs = (data?.databases ?? []).filter(
    (name) => !connections.some((c) => c.databaseName === name && c.maskedUri === data?.maskedUri)
  );

  if (!data?.connected && connections.length === 0) {
    return (
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Not connected</p>
            <p className="text-xs text-slate-500">Save a database or connect QuickBooks / Outlook to start</p>
          </div>
          <Badge tone="amber">Demo</Badge>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">{data?.connected ? "Active source" : "Saved sources"}</p>
            {data?.connected ? <Badge tone="green">Live</Badge> : <Badge tone="amber">Offline</Badge>}
            {data?.engine ? <Badge>{engineLabel(data.engine)}</Badge> : null}
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
            <dt className="text-slate-500">Name</dt>
            <dd className="truncate">{data?.connectionName ?? data?.database ?? "None"}</dd>
            {!isExternalAppEngine(data?.engine) ? (
              <>
                <dt className="text-slate-500">Database</dt>
                <dd>{data?.database ?? "Select a database"}</dd>
                <dt className="text-slate-500">Tables / collections</dt>
                <dd>{data?.collectionCount ?? data?.schemaSummary?.collectionCount ?? "—"}</dd>
              </>
            ) : isOutlookEngine(data?.engine) ? (
              <>
                <dt className="text-slate-500">Type</dt>
                <dd>Microsoft Outlook mailbox</dd>
              </>
            ) : (
              <>
                <dt className="text-slate-500">Type</dt>
                <dd>QuickBooks Online (not a database)</dd>
              </>
            )}
          </dl>
          {data?.lastError ? <p className="mt-1 text-[11px] text-rose-600">{data.lastError}</p> : null}
        </div>
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              refresh.mutate(undefined, {
                onSuccess: () => toast.success("Schema refreshed"),
                onError: (e) => toast.error(e instanceof ApiError ? e.message : "Refresh failed")
              })
            }
            disabled={refresh.isPending || !data?.connected || data.needsDatabaseSelection}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() =>
              disconnect.mutate(
                { forget: false },
                {
                  onSuccess: () => toast.message("Disconnected. Saved sources kept."),
                  onError: (e) => toast.error(e instanceof ApiError ? e.message : "Disconnect failed")
                }
              )
            }
            disabled={!data?.connected}
          >
            <Unplug className="h-3.5 w-3.5" />
            Disconnect
          </Button>
        </div>
      </div>

      {databases.length ? (
        <SavedList
          title="Databases"
          items={databases}
          activeId={data?.activeConnectionId}
          onActivate={(id, name) =>
            activate.mutate(id, {
              onSuccess: () => toast.success(`Chatting with ${name}`),
              onError: (e) => toast.error(e instanceof ApiError ? e.message : "Switch failed")
            })
          }
          onRemove={(id, name) =>
            disconnect.mutate(
              { connectionId: id, forget: true },
              {
                onSuccess: () => toast.message(`Removed ${name}`),
                onError: (e) => toast.error(e instanceof ApiError ? e.message : "Remove failed")
              }
            )
          }
        />
      ) : null}

      {qbAccounts.length ? (
        <SavedList
          title="QuickBooks accounts"
          items={qbAccounts}
          activeId={data?.activeConnectionId}
          onActivate={(id, name) =>
            activate.mutate(id, {
              onSuccess: () => toast.success(`Chatting with ${name}`),
              onError: (e) => toast.error(e instanceof ApiError ? e.message : "Switch failed")
            })
          }
          onRemove={(id, name) =>
            disconnect.mutate(
              { connectionId: id, forget: true },
              {
                onSuccess: () => toast.message(`Removed ${name}`),
                onError: (e) => toast.error(e instanceof ApiError ? e.message : "Remove failed")
              }
            )
          }
        />
      ) : null}

      {outlookAccounts.length ? (
        <SavedList
          title="Outlook mailboxes"
          items={outlookAccounts}
          activeId={data?.activeConnectionId}
          onActivate={(id, name) =>
            activate.mutate(id, {
              onSuccess: () => toast.success(`Chatting with ${name}`),
              onError: (e) => toast.error(e instanceof ApiError ? e.message : "Switch failed")
            })
          }
          onRemove={(id, name) =>
            disconnect.mutate(
              { connectionId: id, forget: true },
              {
                onSuccess: () => toast.message(`Removed ${name}`),
                onError: (e) => toast.error(e instanceof ApiError ? e.message : "Remove failed")
              }
            )
          }
        />
      ) : null}

      {data?.needsDatabaseSelection && data.databases?.length ? (
        <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
          <p className="mb-1.5 text-xs font-medium">Select database</p>
          <div className="flex flex-wrap gap-1.5">
            {data.databases.map((name) => (
              <Button
                key={name}
                variant="outline"
                size="sm"
                onClick={() =>
                  selectDb.mutate(name, {
                    onSuccess: () => toast.success(`Using ${name}`),
                    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Failed")
                  })
                }
              >
                {name}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {data?.connected && !isExternalAppEngine(data.engine) && extraDbs.length ? (
        <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
          <p className="mb-1.5 text-xs font-medium">Add another database on this server</p>
          <div className="flex flex-wrap gap-1.5">
            {extraDbs.map((name) => (
              <Button
                key={name}
                variant="outline"
                size="sm"
                onClick={() =>
                  addDb.mutate(
                    { databaseName: name, name },
                    {
                      onSuccess: () => toast.success(`Added ${name}`),
                      onError: (e) => toast.error(e instanceof ApiError ? e.message : "Failed")
                    }
                  )
                }
              >
                {name}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function SavedList({
  title,
  items,
  activeId,
  onActivate,
  onRemove
}: {
  title: string;
  items: {
    id: string;
    name: string;
    databaseName?: string;
    maskedUri: string;
    connected: boolean;
    lastError?: string;
    engine?: string;
  }[];
  activeId?: string;
  onActivate: (id: string, name: string) => void;
  onRemove: (id: string, name: string) => void;
}) {
  return (
    <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
      <p className="mb-1.5 text-xs font-medium">{title}</p>
      <div className="space-y-1.5">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs dark:border-slate-700"
          >
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onActivate(item.id, item.name)}>
              <p className="font-medium">
                {item.name}
                {item.id === activeId ? (
                  <span className="ml-1.5 text-[10px] font-normal text-teal-700 dark:text-teal-300">active</span>
                ) : null}
                <span className="ml-1.5 text-[10px] font-normal text-slate-400">{engineLabel(item.engine)}</span>
              </p>
              <p className="truncate text-[10px] text-slate-500">
                {isQuickBooksEngine(item.engine)
                  ? "QuickBooks company"
                  : isOutlookEngine(item.engine)
                    ? "Outlook mailbox"
                    : `${item.databaseName ?? "No database"} · ${item.maskedUri}`}
                {item.connected ? "" : " · not live"}
              </p>
              {item.lastError ? <p className="text-[10px] text-rose-600">{item.lastError}</p> : null}
            </button>
            <Button variant="ghost" size="sm" onClick={() => onRemove(item.id, item.name)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
