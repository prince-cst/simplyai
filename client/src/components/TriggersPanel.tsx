import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, Loader2, Play, Pause, Trash2, Check, Sparkles, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Input, Textarea } from "@/components/ui";
import { useMongoStatus } from "@/hooks/useMongo";
import {
  useApproveTrigger,
  useCreateTrigger,
  useDeleteTrigger,
  usePatchTrigger,
  useProposeTrigger,
  useTestTrigger,
  useTriggers
} from "@/hooks/useTriggers";
import {
  ApiError,
  type TriggerDefinition,
  type TriggerProposal,
  type TriggerWindow,
  type TriggerWindowCondition
} from "@/types/api";
import { formatDate } from "@/lib/utils";
import type { TriggerDedupeBucket } from "@/types/api";

const SCHEDULE_PRESETS: Array<{
  id: string;
  label: string;
  cron: string;
  dedupeBucket: TriggerDedupeBucket;
}> = [
  { id: "every_1_min", label: "Every 1 minute", cron: "* * * * *", dedupeBucket: "minute" },
  { id: "every_5_min", label: "Every 5 minutes", cron: "*/5 * * * *", dedupeBucket: "minute" },
  { id: "every_15_min", label: "Every 15 minutes", cron: "*/15 * * * *", dedupeBucket: "minute" },
  { id: "every_30_min", label: "Every 30 minutes", cron: "*/30 * * * *", dedupeBucket: "minute" },
  { id: "hourly", label: "Every hour", cron: "0 * * * *", dedupeBucket: "hour" },
  { id: "daily_9am", label: "Every day at 9:00 AM", cron: "0 9 * * *", dedupeBucket: "day" },
  { id: "weekly_mon_9am", label: "Every Monday at 9:00 AM", cron: "0 9 * * 1", dedupeBucket: "week" },
  {
    id: "monthly_1st_9am",
    label: "1st of each month at 9:00 AM",
    cron: "0 9 1 * *",
    dedupeBucket: "month"
  }
];

function schedulePresetId(cron: string): string {
  return SCHEDULE_PRESETS.find((p) => p.cron === cron)?.id ?? "custom";
}

function conditionSummary(c: TriggerWindowCondition): string {
  if (c.kind === "daysUntil") return `${c.minDays}–${c.maxDays} days until`;
  if (c.kind === "onOrBefore") return `today → ${c.date}`;
  if (c.kind === "onOrAfter") return `on/after ${c.date}`;
  if (c.kind === "newDocuments") return "new/updated since last check";
  return `${c.fromDate} → ${c.toDate}`;
}

function emptyProposal(
  engine: TriggerProposal["target"]["engine"] = "mongodb",
  connectionId = ""
): TriggerProposal {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return {
    name: "",
    explanation: "",
    connectionId,
    userPrompt: "Manual trigger",
    target: {
      engine,
      collectionOrTable: "",
      dateField: ""
    },
    windows: [
      {
        id: "w1",
        label: "Will expire by cutoff date",
        condition: { kind: "onOrBefore", date: todayStr },
        schedule: { cron: "*/5 * * * *" },
        dedupeBucket: "minute"
      }
    ],
    email: {
      to: [],
      subjectTemplate: "Alert: {{matchCount}} item(s) — {{name}}",
      bodyTemplate: "New matches for {{name}}:\n\n{{rows}}",
      displayFields: []
    }
  };
}

function defaultCondition(kind: TriggerWindowCondition["kind"]): TriggerWindowCondition {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const todayStr = `${yyyy}-${mm}-${dd}`;
  if (kind === "daysUntil") return { kind: "daysUntil", minDays: 0, maxDays: 30 };
  if (kind === "onOrBefore") return { kind: "onOrBefore", date: "2026-09-15" };
  if (kind === "onOrAfter") return { kind: "onOrAfter", date: todayStr };
  if (kind === "newDocuments") return { kind: "newDocuments" };
  return { kind: "between", fromDate: todayStr, toDate: "2026-09-15" };
}

function proposalFromTrigger(t: TriggerDefinition): TriggerProposal {
  return {
    name: t.name,
    explanation: t.explanation,
    connectionId: t.connectionId,
    userPrompt: t.userPrompt,
    target: { ...t.target },
    windows: t.windows.map((w) => ({ ...w, schedule: { ...w.schedule }, condition: { ...w.condition } })),
    email: { ...t.email, to: [...t.email.to] }
  };
}

export function TriggersPanel() {
  const status = useMongoStatus();
  const triggers = useTriggers();
  const propose = useProposeTrigger();
  const create = useCreateTrigger();
  const patch = usePatchTrigger();
  const approve = useApproveTrigger();
  const remove = useDeleteTrigger();
  const testRun = useTestTrigger();

  const [prompt, setPrompt] = useState(
    "Alert me every 5 minutes for documents that expire on or before 15 September 2026."
  );
  const [draft, setDraft] = useState<TriggerProposal | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [recipients, setRecipients] = useState("");

  const connected = Boolean(status.data?.connected && status.data.engine !== "quickbooks" && status.data.engine !== "outlook");
  const activeConnectionId = status.data?.activeConnectionId;
  const activeConnectionName = status.data?.connectionName ?? status.data?.database ?? "Active database";
  const engine = (status.data?.engine === "mysql" || status.data?.engine === "mssql"
    ? status.data.engine
    : "mongodb") as TriggerProposal["target"]["engine"];
  const list = triggers.data?.triggers ?? [];
  const smtpOk = triggers.data?.smtpConfigured ?? false;
  const [onlyActiveDb, setOnlyActiveDb] = useState(false);

  const visibleTriggers = useMemo(() => {
    if (!onlyActiveDb || !activeConnectionId) return list;
    return list.filter((t) => t.connectionId === activeConnectionId);
  }, [list, onlyActiveDb, activeConnectionId]);

  const groupedTriggers = useMemo(() => {
    const map = new Map<
      string,
      { connectionId: string; title: string; missing?: boolean; items: TriggerDefinition[] }
    >();
    for (const t of visibleTriggers) {
      const key = t.connectionId || "unknown";
      const title = t.connectionMissing
        ? `Missing connection (${t.connectionId.slice(0, 8)}…)`
        : `${t.connectionName ?? "Connection"}${t.databaseName ? ` · ${t.databaseName}` : ""}${
            t.connectionEngine ? ` · ${t.connectionEngine}` : ""
          }`;
      const bucket = map.get(key) ?? {
        connectionId: key,
        title,
        missing: t.connectionMissing,
        items: []
      };
      bucket.items.push(t);
      map.set(key, bucket);
    }
    return [...map.values()];
  }, [visibleTriggers]);

  const draftReady = useMemo(() => {
    if (!draft) return false;
    return Boolean(
      draft.name &&
        draft.connectionId &&
        draft.target.collectionOrTable &&
        draft.target.dateField &&
        draft.windows.length &&
        recipients
          .split(/[,;\s]+/)
          .map((e) => e.trim())
          .filter(Boolean).length
    );
  }, [draft, recipients]);

  const onPropose = () => {
    if (!activeConnectionId) {
      toast.error("Connect a database first");
      return;
    }
    propose.mutate(
      { prompt, connectionId: activeConnectionId },
      {
        onSuccess: (data) => {
          setEditingId(null);
          setDraft({
            ...data.proposal,
            connectionId: data.proposal.connectionId || activeConnectionId,
            target: {
              ...data.proposal.target,
              engine
            }
          });
          setRecipients(data.proposal.email.to.join(", "));
          toast.success(`Proposal for ${activeConnectionName}`);
        },
        onError: (err) => {
          const msg = err instanceof ApiError ? err.message : "Proposal failed";
          toast.error(msg);
        }
      }
    );
  };

  const onSave = (activate: boolean) => {
    if (!draft) return;
    const connectionId = draft.connectionId || activeConnectionId;
    if (!connectionId) {
      toast.error("Connect a database first");
      return;
    }
    const to = recipients
      .split(/[,;\s]+/)
      .map((e) => e.trim())
      .filter(Boolean);
    const payload = {
      ...draft,
      connectionId,
      target: { ...draft.target, engine: draft.target.engine || engine },
      email: { ...draft.email, to },
      status: (activate ? "active" : editingId ? undefined : "draft") as
        | TriggerDefinition["status"]
        | undefined
    };

    if (editingId) {
      patch.mutate(
        {
          id: editingId,
          name: payload.name,
          explanation: payload.explanation,
          target: payload.target,
          windows: payload.windows,
          email: payload.email,
          ...(activate ? { status: "active" as const } : {})
        },
        {
          onSuccess: () => {
            toast.success(activate ? "Trigger updated & activated" : "Trigger updated");
            setDraft(null);
            setEditingId(null);
          },
          onError: (err) => toast.error(err instanceof ApiError ? err.message : "Update failed")
        }
      );
      return;
    }

    create.mutate(
      {
        ...payload,
        status: activate ? "active" : "draft"
      },
      {
        onSuccess: () => {
          toast.success(activate ? "Trigger activated" : "Draft saved");
          setDraft(null);
        },
        onError: (err) => toast.error(err instanceof ApiError ? err.message : "Save failed")
      }
    );
  };

  const startEdit = (t: TriggerDefinition) => {
    setEditingId(t.id);
    setDraft(proposalFromTrigger(t));
    setRecipients(t.email.to.join(", "));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const updateWindow = (index: number, patchWin: Partial<TriggerWindow>) => {
    if (!draft) return;
    const windows = draft.windows.map((w, i) => (i === index ? { ...w, ...patchWin } : w));
    setDraft({ ...draft, windows });
  };

  const setConditionKind = (index: number, kind: TriggerWindowCondition["kind"]) => {
    if (!draft) return;
    const current = draft.windows[index]?.condition;
    if (current?.kind === kind) return;
    updateWindow(index, { condition: defaultCondition(kind) });
  };

  if (!connected) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-10 text-center dark:border-slate-700 dark:bg-slate-900/40">
        <Bell className="mx-auto mb-2 h-7 w-7 text-slate-400" />
        <p className="text-sm font-medium">Connect a MongoDB or SQL database first</p>
        <p className="mt-1 text-[11px] text-slate-500">Triggers read live data from your active connection.</p>
        <Link
          to="/connections"
          className="mt-3 inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-3 text-xs font-medium text-white hover:bg-brand-700"
        >
          Open Connections
        </Link>
      </div>
    );
  }

  const saving = create.isPending || patch.isPending;

  return (
    <div className="space-y-3">
      {!smtpOk ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          SMTP is not configured. Add SMTP_* in <code>server/.env</code> to send emails. You can still propose and dry-run.
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      {/* Create column */}
      <div className="space-y-3">
      <div className="space-y-2.5 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900/40">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <Sparkles className="h-3.5 w-3.5 text-brand-600" />
          Describe an alert
        </div>
        <Textarea
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. Every 5 minutes, email me documents that expire on or before 15 September 2026"
          className="text-xs"
        />
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" onClick={onPropose} disabled={propose.isPending || prompt.trim().length < 3}>
            {propose.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Propose with AI
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (!activeConnectionId) {
                toast.error("Connect a database first");
                return;
              }
              setEditingId(null);
              setDraft(emptyProposal(engine, activeConnectionId));
              setRecipients("");
            }}
          >
            Blank draft
          </Button>
        </div>
        <p className="text-[10px] text-slate-500">
          Saved for:{" "}
          <span className="font-medium text-slate-700 dark:text-slate-200">{activeConnectionName}</span>
          {status.data?.database ? ` (${status.data.database})` : ""}. Switch source in the header for another DB.
        </p>
      </div>

      {draft ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900/40">
          <p className="text-xs font-semibold">{editingId ? "Edit trigger" : "Review proposal"}</p>
          <p className="text-xs text-slate-500">{draft.explanation}</p>
          <p className="rounded-md bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600 dark:bg-slate-900/60 dark:text-slate-300">
            Database:{" "}
            <span className="font-medium">
              {editingId
                ? list.find((t) => t.id === editingId)?.connectionName ??
                  activeConnectionName
                : activeConnectionName}
            </span>
            {editingId
              ? " (locked to the connection this trigger was created with)"
              : " — this trigger will always run against this connection"}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs">
              Name
              <Input
                className="mt-1"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label className="block text-xs">
              Recipients (comma-separated)
              <Input
                className="mt-1"
                value={recipients}
                onChange={(e) => setRecipients(e.target.value)}
                placeholder="you@company.com"
              />
            </label>
            <label className="block text-xs">
              Collection / table
              <Input
                className="mt-1"
                value={draft.target.collectionOrTable}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    target: { ...draft.target, collectionOrTable: e.target.value }
                  })
                }
              />
            </label>
            <label className="block text-xs">
              Date field
              <Input
                className="mt-1"
                value={draft.target.dateField}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    target: { ...draft.target, dateField: e.target.value }
                  })
                }
              />
            </label>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium">Windows</p>
            {draft.windows.map((w, i) => (
              <div
                key={w.id || i}
                className="grid gap-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700 sm:grid-cols-6"
              >
                <Input
                  value={w.label}
                  onChange={(e) => updateWindow(i, { label: e.target.value })}
                  placeholder="Label"
                  className="sm:col-span-2"
                />
                <select
                  className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                  value={w.condition.kind}
                  onChange={(e) =>
                    setConditionKind(i, e.target.value as TriggerWindowCondition["kind"])
                  }
                >
                  <option value="newDocuments">New/updated rows (since last check)</option>
                  <option value="onOrBefore">On or before (from today)</option>
                  <option value="between">Between two dates</option>
                  <option value="onOrAfter">On or after date</option>
                  <option value="daysUntil">Days until</option>
                </select>
                {w.condition.kind === "daysUntil" ? (
                  <>
                    <Input
                      type="number"
                      value={w.condition.minDays}
                      onChange={(e) => {
                        const current = w.condition;
                        if (current.kind !== "daysUntil") return;
                        updateWindow(i, {
                          condition: {
                            kind: "daysUntil",
                            minDays: Number(e.target.value),
                            maxDays: current.maxDays
                          }
                        });
                      }}
                      placeholder="Min days"
                    />
                    <Input
                      type="number"
                      value={w.condition.maxDays}
                      onChange={(e) => {
                        const current = w.condition;
                        if (current.kind !== "daysUntil") return;
                        updateWindow(i, {
                          condition: {
                            kind: "daysUntil",
                            minDays: current.minDays,
                            maxDays: Number(e.target.value)
                          }
                        });
                      }}
                      placeholder="Max days"
                    />
                  </>
                ) : w.condition.kind === "between" ? (
                  <>
                    <Input
                      type="date"
                      value={w.condition.fromDate}
                      onChange={(e) => {
                        const current = w.condition;
                        if (current.kind !== "between") return;
                        updateWindow(i, {
                          condition: {
                            kind: "between",
                            fromDate: e.target.value,
                            toDate: current.toDate
                          }
                        });
                      }}
                    />
                    <Input
                      type="date"
                      value={w.condition.toDate}
                      onChange={(e) => {
                        const current = w.condition;
                        if (current.kind !== "between") return;
                        updateWindow(i, {
                          condition: {
                            kind: "between",
                            fromDate: current.fromDate,
                            toDate: e.target.value
                          }
                        });
                      }}
                    />
                  </>
                ) : w.condition.kind === "newDocuments" ? (
                  <p className="self-center text-[10px] text-slate-500 sm:col-span-2">
                    Uses the Date field above as created/updated time. First live run arms the watch
                    (no historical dump). Prefer Every 1–5 minutes.
                  </p>
                ) : (
                  <Input
                    type="date"
                    className="sm:col-span-2"
                    value={w.condition.date}
                    onChange={(e) => {
                      const kind = w.condition.kind;
                      if (kind !== "onOrBefore" && kind !== "onOrAfter") return;
                      updateWindow(i, {
                        condition: { kind, date: e.target.value }
                      });
                    }}
                  />
                )}
                <label className="block text-[10px] text-slate-500 sm:col-span-4">
                  Check how often
                  <select
                    className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900"
                    value={schedulePresetId(w.schedule.cron)}
                    onChange={(e) => {
                      const preset = SCHEDULE_PRESETS.find((p) => p.id === e.target.value);
                      if (!preset) {
                        updateWindow(i, {
                          schedule: { ...w.schedule, cron: w.schedule.cron || "*/5 * * * *" }
                        });
                        return;
                      }
                      updateWindow(i, {
                        schedule: { ...w.schedule, cron: preset.cron },
                        dedupeBucket: preset.dedupeBucket
                      });
                    }}
                  >
                    {SCHEDULE_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                    <option value="custom">Custom schedule…</option>
                  </select>
                </label>
                {schedulePresetId(w.schedule.cron) === "custom" ? (
                  <Input
                    value={w.schedule.cron}
                    onChange={(e) =>
                      updateWindow(i, { schedule: { ...w.schedule, cron: e.target.value } })
                    }
                    placeholder="Custom cron (advanced)"
                    className="sm:col-span-2"
                  />
                ) : (
                  <p className="self-end text-[10px] text-slate-400 sm:col-span-2">
                    {SCHEDULE_PRESETS.find((p) => p.cron === w.schedule.cron)?.label ?? w.schedule.cron}
                  </p>
                )}
              </div>
            ))}
            <p className="text-[10px] text-slate-500">
              Pick how often to check from the dropdown. Use Custom only if you need an advanced schedule.
            </p>
          </div>

          <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50/80 p-3">
            <p className="text-xs font-medium text-slate-700">Email message</p>
            <p className="text-[11px] leading-relaxed text-slate-500">
              Leave <code className="rounded bg-white px-1">{"{{rows}}"}</code> in the message —
              each match is listed with readable details (shop name, device, amount, dates). You do
              not need to write field placeholders yourself.
            </p>
            <label className="block text-xs">
              Details to include (optional)
              <Input
                className="mt-1"
                value={(draft.email.displayFields ?? []).join(", ")}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    email: {
                      ...draft.email,
                      displayFields: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean)
                    }
                  })
                }
                placeholder="e.g. shop, device, amount"
              />
              <span className="mt-1 block text-[10px] text-slate-400">
                Comma-separated. Leave blank to auto-pick useful fields. Aliases like shop / device /
                amount work.
              </span>
            </label>
            <label className="block text-xs">
              Subject
              <Input
                className="mt-1"
                value={draft.email.subjectTemplate}
                onChange={(e) =>
                  setDraft({ ...draft, email: { ...draft.email, subjectTemplate: e.target.value } })
                }
              />
            </label>
            <label className="block text-xs">
              Message
              <Textarea
                className="mt-1"
                rows={4}
                value={draft.email.bodyTemplate}
                onChange={(e) =>
                  setDraft({ ...draft, email: { ...draft.email, bodyTemplate: e.target.value } })
                }
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" disabled={!draftReady || saving} onClick={() => onSave(true)}>
              <Check className="h-3.5 w-3.5" />
              {editingId ? "Save & activate" : "Approve & activate"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!draftReady || saving}
              onClick={() => onSave(false)}
            >
              {editingId ? "Save changes" : "Save draft"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(null);
                setEditingId(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      </div>

      {/* List column */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold">Your triggers</p>
          <label className="flex items-center gap-1.5 text-[10px] text-slate-500">
            <input
              type="checkbox"
              className="rounded"
              checked={onlyActiveDb}
              onChange={(e) => setOnlyActiveDb(e.target.checked)}
            />
            Only active DB
          </label>
        </div>
        {!visibleTriggers.length ? (
          <div className="rounded-xl border border-dashed border-slate-200 px-3 py-8 text-center dark:border-slate-700">
            <p className="text-[11px] text-slate-500">
              {onlyActiveDb
                ? "No triggers for the active database yet."
                : "No triggers yet. Describe an alert and propose with AI."}
            </p>
          </div>
        ) : (
          groupedTriggers.map((group) => (
            <div key={group.connectionId} className="space-y-1.5">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                {group.title}
                {group.connectionId === activeConnectionId ? " · active" : ""}
              </p>
              {group.items.map((t) => (
            <div
              key={t.id}
              className="rounded-xl border border-slate-200 bg-white p-2.5 dark:border-slate-800 dark:bg-slate-900/40"
            >
              <div className="flex flex-col gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-xs font-medium">{t.name}</p>
                    <Badge
                      tone={t.status === "active" ? "green" : t.status === "paused" ? "amber" : "slate"}
                    >
                      {t.status}
                    </Badge>
                    {t.connectionMissing ? <Badge tone="amber">missing</Badge> : null}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[10px] text-slate-500">{t.explanation}</p>
                  <p className="mt-1 text-[9px] leading-relaxed text-slate-400">
                    {t.target.collectionOrTable}.{t.target.dateField} ·{" "}
                    {t.windows.map((w) => `${conditionSummary(w.condition)}`).join("; ")} ·{" "}
                    {t.email.to.join(", ")}
                    {t.lastRunAt ? ` · ${formatDate(t.lastRunAt)}` : ""}
                  </p>
                  {t.lastError ? <p className="mt-1 text-[10px] text-rose-600">{t.lastError}</p> : null}
                  {t.recentRuns[0] ? (
                    <p className="mt-0.5 text-[9px] text-slate-400">
                      Last: {t.recentRuns[0].matchCount} match(es)
                      {t.recentRuns[0].emailed ? ", emailed" : ""}
                      {t.recentRuns[0].dryRun ? " (dry-run)" : ""}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button size="sm" variant="outline" onClick={() => startEdit(t)}>
                    <Pencil className="h-3 w-3" />
                    Edit
                  </Button>
                  {t.status !== "active" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={approve.isPending || t.connectionMissing}
                      onClick={() =>
                        approve.mutate(t.id, {
                          onSuccess: () => toast.success("Activated"),
                          onError: (e) => toast.error(e instanceof ApiError ? e.message : "Failed")
                        })
                      }
                    >
                      <Play className="h-3 w-3" />
                      Activate
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={patch.isPending}
                      onClick={() =>
                        patch.mutate(
                          { id: t.id, status: "paused" },
                          { onSuccess: () => toast.message("Paused") }
                        )
                      }
                    >
                      <Pause className="h-3 w-3" />
                      Pause
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={testRun.isPending || t.connectionMissing}
                    onClick={() =>
                      testRun.mutate(
                        { id: t.id, sendEmail: false },
                        {
                          onSuccess: (r) =>
                            toast.success(`Dry-run: ${r.run.matchCount} match(es)`),
                          onError: (e) => toast.error(e instanceof ApiError ? e.message : "Test failed")
                        }
                      )
                    }
                  >
                    Test
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={testRun.isPending || !smtpOk || t.connectionMissing}
                    onClick={() =>
                      testRun.mutate(
                        { id: t.id, sendEmail: true },
                        {
                          onSuccess: (r) =>
                            toast.success(
                              r.run.emailed
                                ? `Emailed ${r.run.matchCount} match(es)`
                                : `No new matches (${r.run.matchCount})`
                            ),
                          onError: (e) => toast.error(e instanceof ApiError ? e.message : "Send failed")
                        }
                      )
                    }
                  >
                    Email
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={remove.isPending}
                    onClick={() =>
                      remove.mutate(t.id, { onSuccess: () => toast.message("Deleted") })
                    }
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
              ))}
            </div>
          ))
        )}
      </div>
      </div>
    </div>
  );
}
