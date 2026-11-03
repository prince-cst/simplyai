import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { MessageSquare, RefreshCw, Search } from "lucide-react";
import { Badge, Button, Input, PageHeader, SectionLabel, Skeleton } from "@/components/ui";
import { JsonViewer } from "@/components/JsonViewer";
import {
  useCollection,
  useMongoStatus,
  useRefreshSchema,
  useSample,
  useSchema
} from "@/hooks/useMongo";
import { engineLabel, isOutlookEngine, isQuickBooksEngine, isSqlEngine } from "@/lib/engines";
import { formatDate } from "@/lib/utils";
import { ApiError } from "@/types/api";
import { cn } from "@/lib/utils";

export function ExplorerPage() {
  const status = useMongoStatus();
  const schema = useSchema();
  const refresh = useRefreshSchema();
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const engine = status.data?.engine ?? "mongodb";
  const entityWord = isQuickBooksEngine(engine)
    ? "entities"
    : isOutlookEngine(engine)
      ? "folders"
      : isSqlEngine(engine)
        ? "tables"
        : "collections";

  const collections = useMemo(
    () => schema.data?.schema.collections ?? [],
    [schema.data]
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return collections;
    return collections.filter((c) => c.name.toLowerCase().includes(q));
  }, [collections, filter]);

  const refreshBtn = (
    <Button
      variant="outline"
      size="sm"
      onClick={() =>
        refresh.mutate(undefined, {
          onSuccess: () => toast.success("Schema refreshed"),
          onError: (e) => toast.error(e instanceof ApiError ? e.message : "Failed")
        })
      }
      disabled={refresh.isPending || !status.data?.connected}
    >
      <RefreshCw className={cn("h-3.5 w-3.5", refresh.isPending && "animate-spin")} />
      Refresh
    </Button>
  );

  if (!status.data?.connected) {
    return (
      <div className="mx-auto max-w-lg py-12 text-center">
        <PageHeader title="Explorer" subtitle="Browse schema for the active source." />
        <p className="mt-4 text-xs text-slate-500">Connect a database, QuickBooks, or Outlook first.</p>
        <Link
          to="/connections"
          className="mt-3 inline-flex h-8 items-center rounded-lg bg-brand-600 px-3 text-xs font-medium text-white hover:bg-brand-700"
        >
          Open Connections
        </Link>
      </div>
    );
  }

  if (isOutlookEngine(engine)) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title="Explorer"
          subtitle="Outlook folders available to Simply AI for mail questions."
          actions={refreshBtn}
        />
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/40">
          <p className="text-xs text-slate-600 dark:text-slate-300">
            Chat can fetch and summarize messages from your mailbox. Try &quot;summarize today&apos;s emails&quot;.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(schema.data?.schema.collections ?? []).map((c) => (
              <Badge key={c.name} tone="teal">
                {c.name}
              </Badge>
            ))}
          </div>
          <Link
            to="/chat"
            className="mt-4 inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-[11px] font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            <MessageSquare className="h-3 w-3" />
            Ask in Chat
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-5.5rem)] flex-col">
      <PageHeader
        title="Explorer"
        subtitle={`${engineLabel(engine)} · ${collections.length} ${entityWord}${
          schema.data?.introspectedAt ? ` · ${formatDate(schema.data.introspectedAt)}` : ""
        }`}
        actions={refreshBtn}
      />

      {schema.isLoading ? (
        <Skeleton className="h-48" />
      ) : (
        <div className="grid min-h-0 flex-1 gap-0 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/30 lg:grid-cols-[15rem_1fr]">
          {/* Left list */}
          <div className="flex min-h-0 flex-col border-b border-slate-200 dark:border-slate-800 lg:border-b-0 lg:border-r">
            <div className="border-b border-slate-100 p-2 dark:border-slate-800">
              <SectionLabel className="mb-1.5 px-0.5">
                {schema.data?.schema.database ?? status.data.database ?? "—"}
              </SectionLabel>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
                <Input
                  className="h-7 pl-7 text-[11px]"
                  placeholder={`Filter ${entityWord}…`}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>
            </div>
            <ul className="min-h-0 flex-1 overflow-y-auto p-1">
              {filtered.map((c) => (
                <li key={c.name}>
                  <button
                    type="button"
                    onClick={() => setSelected(c.name)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[11px] transition hover:bg-slate-50 dark:hover:bg-slate-800/60",
                      selected === c.name && "bg-brand-50 text-brand-800 dark:bg-brand-600/15 dark:text-teal-200"
                    )}
                  >
                    <span className="truncate font-medium">{c.name}</span>
                    <span className="ml-2 shrink-0 font-mono text-[9px] text-slate-400">
                      {c.estimatedCount.toLocaleString()}
                    </span>
                  </button>
                </li>
              ))}
              {!filtered.length ? (
                <li className="px-2 py-3 text-[11px] text-slate-400">No matches.</li>
              ) : null}
            </ul>
          </div>

          {/* Detail */}
          <div className="min-h-0 min-w-0 overflow-y-auto p-3">
            {selected ? (
              <SchemaPanel
                name={selected}
                showSample={!isQuickBooksEngine(engine) && !isOutlookEngine(engine)}
              />
            ) : (
              <div className="flex h-full min-h-[12rem] flex-col items-center justify-center text-center">
                <p className="text-xs text-slate-500">Select a {entityWord.replace(/s$/, "")} to inspect fields.</p>
                {collections[0] ? (
                  <button
                    type="button"
                    className="mt-2 text-[11px] font-medium text-brand-700 underline dark:text-teal-300"
                    onClick={() => setSelected(collections[0]!.name)}
                  >
                    Open {collections[0]!.name}
                  </button>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SchemaPanel({ name, showSample }: { name: string; showSample: boolean }) {
  const details = useCollection(name);
  const sample = useSample(showSample ? name : undefined, 5);
  const collection = details.data?.collection;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{name}</h2>
          {collection ? (
            <p className="text-[10px] text-slate-400">
              ~{collection.estimatedCount.toLocaleString()} rows · {collection.fields.length} fields
            </p>
          ) : null}
        </div>
        <Link
          to="/chat"
          className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 px-2 text-[11px] font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          <MessageSquare className="h-3 w-3" />
          Ask about this
        </Link>
      </div>

      {details.isLoading || !collection ? (
        <p className="text-xs text-slate-400">Loading schema…</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="min-w-full text-[11px]">
            <thead>
              <tr className="bg-slate-50 text-left text-[9px] uppercase tracking-wide text-slate-400 dark:bg-slate-800/50">
                <th className="px-2.5 py-1.5 font-medium">Field</th>
                <th className="px-2.5 py-1.5 font-medium">Type</th>
              </tr>
            </thead>
            <tbody>
              {collection.fields.map((f) => (
                <tr key={f.path} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-2.5 py-1 font-mono">{f.path}</td>
                  <td className="px-2.5 py-1">
                    <Badge>{f.type}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showSample && sample.data ? (
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <SectionLabel>Sample (max 5)</SectionLabel>
            <Button variant="ghost" size="sm" onClick={() => void sample.refetch()}>
              Refresh
            </Button>
          </div>
          <JsonViewer title="Sample" value={sample.data.documents} />
        </div>
      ) : null}
    </div>
  );
}
