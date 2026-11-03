import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUp, Loader2, MessageSquarePlus, RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import { Badge, Button, Textarea } from "@/components/ui";
import { Collapsible } from "@/components/JsonViewer";
import { QueryPlanViewer, queryPlanCollapsibleTitle } from "@/components/QueryPlanViewer";
import { ResultChart, ResultTable } from "@/components/QueryResultViewer";
import { JsonViewer } from "@/components/JsonViewer";
import { useMongoStatus, useSelectDatabase } from "@/hooks/useMongo";
import { useSettings, useUpdateSettings } from "@/hooks/useSettings";
import { useNewChat, useSessionHistory } from "@/hooks/useHistory";
import { extractFailedModel, isQuotaFailure, quotaToast } from "@/lib/chatErrors";
import { isSqlEngine, isQuickBooksEngine, isOutlookEngine, engineLabel } from "@/lib/engines";
import { messagesFromSession } from "@/lib/chatTranscript";
import { useChatStore, type ChatItem } from "@/stores/chatStore";
import { ApiError, type ChatResponse } from "@/types/api";
import { cn } from "@/lib/utils";

type AskExtra = {
  executePendingId?: string;
  cancelPendingId?: string;
  useFallback?: boolean;
  message?: string;
  retryOf?: string;
  switchToModel?: string;
};

const DB_EXAMPLES = [
  "How many rows are in each table?",
  "How many orders were created this month?",
  "Which product sold the most?",
  "What was the total revenue last month?",
  "Show me the top 5 customers by spend."
];

const QB_EXAMPLES = [
  "What is my profit and loss this month?",
  "Show aged receivables older than 90 days.",
  "List the latest invoices.",
  "What is my cash balance?",
  "Who are my top overdue customers?"
];

const OUTLOOK_EXAMPLES = [
  "Give me a summary of today's emails.",
  "What unread emails need action today?",
  "List important emails from the last 7 days.",
  "Summarize emails about meetings today.",
  "Show unread high-importance mail."
];

export function ChatWindow() {
  const status = useMongoStatus();
  const settings = useSettings();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const resumeId = searchParams.get("resume");
  const [input, setInput] = useState("");
  const messages = useChatStore((s) => s.messages);
  const setMessages = useChatStore((s) => s.setMessages);
  const append = useChatStore((s) => s.append);
  const remove = useChatStore((s) => s.remove);
  const truncateThrough = useChatStore((s) => s.truncateThrough);
  const history = useSessionHistory();
  const newChat = useNewChat();
  const updateSettings = useUpdateSettings();
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentModel =
    settings.data?.provider === "gemini"
      ? settings.data.gemini.model
      : settings.data?.provider === "ollama"
        ? settings.data.ollama.model
        : settings.data?.groq.model;

  const send = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<ChatResponse>("/chat", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["history"] });
    }
  });

  const selectDb = useSelectDatabase();
  const engine = status.data?.engine ?? "mongodb";
  const needsDatabase = Boolean(status.data?.needsDatabaseSelection);
  const connected = Boolean(status.data?.connected && status.data.database && !needsDatabase);
  const serverHasThread = Boolean(history.data?.chat.length);
  const examples = isOutlookEngine(engine)
    ? OUTLOOK_EXAMPLES
    : isQuickBooksEngine(engine)
      ? QB_EXAMPLES
      : DB_EXAMPLES;

  const connectionHint = needsDatabase
    ? `This ${engineLabel(engine)} server is connected, but no database is selected.`
    : status.data?.lastError
      ? status.data.lastError
      : "Connect a database, QuickBooks, or Outlook from Connections, then pick it in the header.";

  useEffect(() => {
    if (messages.length > 0 || !history.data) return;
    const restored = messagesFromSession(history.data.history, history.data.chat);
    if (restored.length) setMessages(restored);
  }, [history.data, messages.length, setMessages]);

  useEffect(() => {
    if (!resumeId || messages.length === 0) return;
    const el = document.getElementById(`chat-turn-${resumeId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [resumeId, messages]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, send.isPending]);

  const ask = async (question: string, extra: AskExtra = {}) => {
    const { retryOf, switchToModel, ...postBody } = extra;
    const q = question.trim();
    if (!q && !extra.executePendingId && !extra.cancelPendingId) return;

    if (switchToModel && settings.data) {
      const body =
        settings.data.provider === "gemini"
          ? { gemini: { model: switchToModel } }
          : settings.data.provider === "ollama"
            ? { ollama: { model: switchToModel } }
            : { groq: { model: switchToModel } };
      try {
        await updateSettings.mutateAsync(body);
        toast.message(`Switched model to ${switchToModel}. Retrying this question…`);
      } catch (error) {
        toast.error(error instanceof ApiError ? error.message : "Could not change model", {
          description: "Pick another model in Chat, then click Retry."
        });
        return;
      }
    }

    if (retryOf) remove(retryOf);
    else setInput("");

    const isMeta = Boolean(extra.executePendingId || extra.cancelPendingId);
    if (!isMeta && !retryOf) {
      append({ id: `u-${Date.now()}`, role: "user", text: q });
    }
    try {
      const data = await send.mutateAsync({ message: q || "continue", ...postBody });
      append({
        id: `a-${Date.now()}`,
        role: "assistant",
        text: data.answer || data.queryPlan?.explanation || "Done",
        data
      });
      if (data.usedFallback) toast.message("Used fallback AI provider");
      if (data.rotatedFromModel) {
        toast.message(`Gemini free-tier quota hit on ${data.rotatedFromModel}. Continued with ${data.model}.`);
        void qc.invalidateQueries({ queryKey: ["settings"] });
      }
    } catch (error) {
      const err = error instanceof ApiError ? error : new ApiError("Chat failed");
      const failedModel = err.failedModel || extractFailedModel(err.message) || currentModel;
      const suggestedModel =
        err.suggestedModel || (isQuotaFailure(err.message, err.code) ? "gemini-2.5-flash" : undefined);
      const quota = isQuotaFailure(err.message, err.code);
      const assistantId = `a-${Date.now()}`;
      if (quota) {
        const copy = quotaToast({ failedModel, suggestedModel, hints: err.hints });
        toast.warning(copy.title, {
          description: copy.description,
          duration: 14000,
          action: {
            label: suggestedModel ? `Use ${suggestedModel}` : "Retry",
            onClick: () =>
              void ask(q, {
                retryOf: assistantId,
                ...(suggestedModel ? { switchToModel: suggestedModel } : {})
              })
          }
        });
      } else {
        toast.error(err.message, {
          description: err.hints.join(" · ") || "You can retry this question without typing it again.",
          duration: 10000,
          action: {
            label: "Retry",
            onClick: () => void ask(q, { retryOf: assistantId })
          }
        });
      }
      append({
        id: assistantId,
        role: "assistant",
        text: err.message,
        data: {
          status: "error",
          question: q,
          answer: err.message,
          provider: settings.data?.provider ?? "ollama",
          model: failedModel || "",
          usedFallback: false,
          canFallback: Boolean(settings.data?.fallbackProvider),
          retryable: true,
          failedModel,
          suggestedModel,
          errorCode: err.code,
          explanation: {
            answer: err.message,
            summary: "",
            fieldsUsed: [],
            collectionsUsed: [],
            assumptions: [],
            warnings: err.hints,
            insufficientData: false
          }
        }
      });
    }
  };

  const rerunQuestion = (userMsg: ChatItem) => {
    const idx = messages.findIndex((m) => m.id === userMsg.id);
    if (idx < 0) return;
    const assistant = messages[idx + 1];
    const assistantId = assistant?.role === "assistant" ? assistant.id : undefined;
    truncateThrough(userMsg.id);
    void ask(userMsg.text, { retryOf: assistantId || `__rerun-${userMsg.id}` });
  };

  const empty = messages.length === 0 && !history.isLoading;
  const contextLost = Boolean(
    messages.length > 0 && history.isSuccess && !serverHasThread && messages.some((m) => m.role === "user")
  );
  const busy = send.isPending || updateSettings.isPending;

  return (
    <div className="relative flex h-full flex-col">
      {/* Toolbar when conversation exists */}
      {messages.length > 0 ? (
        <div className="absolute right-3 top-2 z-10">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="bg-white/90 shadow-sm backdrop-blur dark:bg-slate-900/90"
            onClick={() => {
              newChat.mutate(undefined, {
                onSuccess: () => {
                  toast.message("Started a new chat — history kept");
                  navigate("/chat", { replace: true });
                }
              });
            }}
            disabled={newChat.isPending}
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            New chat
          </Button>
        </div>
      ) : null}

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-3 pb-36 pt-4 sm:px-4">
          {contextLost ? (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              Session was reset — follow-ups won&apos;t use previous answers. Ask a new question to start again.
            </div>
          ) : null}

          {!connected && !empty ? (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <p>{connectionHint}</p>
              {needsDatabase && status.data?.databases?.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {status.data.databases.map((name) => (
                    <Button
                      key={name}
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={selectDb.isPending}
                      onClick={() =>
                        selectDb.mutate(name, {
                          onSuccess: () => toast.success(`Using ${name}`),
                          onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not select database")
                        })
                      }
                    >
                      {name}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {empty ? (
            <div className="flex min-h-[55vh] flex-col items-center justify-center text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-lg font-bold text-white shadow-sm">
                S
              </div>
              <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
                {isOutlookEngine(engine)
                  ? "Ask about your mail"
                  : isQuickBooksEngine(engine)
                    ? "Ask about QuickBooks"
                    : "Ask about your data"}
              </h2>
              <p className="mt-1.5 max-w-md text-xs text-slate-500">
                {isOutlookEngine(engine)
                  ? "Simply AI reads your Outlook mailbox and summarizes what matters."
                  : isQuickBooksEngine(engine)
                    ? "Simply AI maps questions to QuickBooks reports and explains real numbers."
                    : `Questions become ${isSqlEngine(engine) ? "SQL" : "MongoDB"} reads, then clear answers.`}
              </p>

              <div className="mt-6 grid w-full max-w-xl gap-2 sm:grid-cols-2">
                {examples.slice(0, 4).map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    disabled={!connected || busy}
                    onClick={() => void ask(ex)}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-[12px] leading-snug text-slate-700 transition hover:border-brand-500/50 hover:bg-brand-50/40 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200 dark:hover:border-brand-500/40"
                  >
                    {ex}
                  </button>
                ))}
              </div>

              {!connected ? (
                <div className="mt-5 max-w-md space-y-2">
                  <p className="text-xs text-amber-700 dark:text-amber-300">{connectionHint}</p>
                  {needsDatabase && status.data?.databases?.length ? (
                    <div className="flex flex-wrap justify-center gap-1.5">
                      {status.data.databases.map((name) => (
                        <Button
                          key={name}
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={selectDb.isPending}
                          onClick={() =>
                            selectDb.mutate(name, {
                              onSuccess: () => toast.success(`Using ${name}`),
                              onError: (e) =>
                                toast.error(e instanceof ApiError ? e.message : "Could not select database")
                            })
                          }
                        >
                          {name}
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <Link
                      to="/connections"
                      className="inline-flex h-7 items-center rounded-lg bg-brand-600 px-3 text-[11px] font-medium text-white hover:bg-brand-700"
                    >
                      Open Connections
                    </Link>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          {history.isLoading && messages.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-400">Restoring conversation…</p>
          ) : null}

          <div className="space-y-5">
            {messages.map((msg) => (
              <ChatMessage
                key={msg.id}
                item={msg}
                highlighted={Boolean(resumeId && msg.historyId === resumeId)}
                developerMode={Boolean(settings.data?.developerMode)}
                busy={busy}
                currentModel={currentModel}
                onApprove={(id) => void ask(msg.data?.question || "Execute approved query", { executePendingId: id })}
                onCancel={(id) => void ask("cancel", { cancelPendingId: id, message: "cancel" })}
                onFallback={() => void ask(msg.data?.question || msg.text, { useFallback: true })}
                onRetry={() => void ask(msg.data?.question || msg.text, { retryOf: msg.id })}
                onSwitchAndRetry={(model) =>
                  void ask(msg.data?.question || msg.text, { retryOf: msg.id, switchToModel: model })
                }
                onRerun={() => rerunQuestion(msg)}
              />
            ))}
          </div>

          {busy ? (
            <div className="mt-5 flex items-center gap-2 text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {updateSettings.isPending
                ? "Updating model…"
                : isOutlookEngine(engine)
                  ? "Reading your Outlook mailbox…"
                  : isQuickBooksEngine(engine)
                    ? "Querying QuickBooks…"
                    : "Thinking…"}
            </div>
          ) : null}
        </div>
      </div>

      {/* Floating composer — ChatGPT style */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-white via-white/95 to-transparent pb-3 pt-10 dark:from-[#0b0f14] dark:via-[#0b0f14]/95">
        <form
          className="pointer-events-auto mx-auto w-full max-w-3xl px-3 sm:px-4"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(input);
          }}
        >
          <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg shadow-slate-200/50 dark:border-slate-700 dark:bg-slate-900 dark:shadow-black/30">
            <Textarea
              rows={1}
              autoFocus={Boolean(resumeId)}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                messages.length
                  ? "Ask a follow-up…"
                  : isOutlookEngine(engine)
                    ? "Ask about today's emails…"
                    : isQuickBooksEngine(engine)
                      ? "Ask anything about QuickBooks…"
                      : "Message Simply AI…"
              }
              className="max-h-36 min-h-[40px] flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm shadow-none ring-0 focus:ring-0 dark:bg-transparent"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void ask(input);
                }
              }}
            />
            <Button
              type="submit"
              size="icon"
              className="mb-0.5 h-8 w-8 shrink-0 rounded-xl"
              disabled={!connected || busy || !input.trim()}
              aria-label="Send"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-slate-400">
            Enter to send · Shift+Enter for new line
          </p>
        </form>
      </div>
    </div>
  );
}

function ChatMessage({
  item,
  highlighted,
  developerMode,
  busy,
  currentModel,
  onApprove,
  onCancel,
  onFallback,
  onRetry,
  onSwitchAndRetry,
  onRerun
}: {
  item: ChatItem;
  highlighted: boolean;
  developerMode: boolean;
  busy: boolean;
  currentModel?: string;
  onApprove: (id: string) => void;
  onCancel: (id: string) => void;
  onFallback: () => void;
  onRetry: () => void;
  onSwitchAndRetry: (model: string) => void;
  onRerun: () => void;
}) {
  const data = item.data;
  const quota = Boolean(data?.status === "error" && isQuotaFailure(data.answer || item.text, data.errorCode));
  const suggested = data?.suggestedModel;
  const viz = data?.explanation?.visualization ?? data?.queryPlan?.visualization;
  const docs = data?.result?.documents ?? [];
  const isOutlook = data?.result?.operation === "outlook" || data?.queryPlan?.operation === "outlook";
  const showRawData = !isOutlook && docs.length > 0;
  const showQueryPlan = Boolean(data?.queryPlan) && (!isOutlook || developerMode);
  const showHowFound = !isOutlook &&
    Boolean(
      data?.explanation?.calculation ||
        data?.explanation?.collectionsUsed.length ||
        data?.queryPlan?.collectionsUsed.length ||
        data?.explanation?.fieldsUsed.length ||
        data?.queryPlan?.fieldsUsed.length ||
        data?.explanation?.assumptions.length ||
        data?.queryPlan?.assumptions.length
    );
  const metric = useMemo(() => {
    if (isOutlook || viz?.type !== "metric" || docs.length !== 1) return null;
    const row = docs[0];
    if (!row || typeof row !== "object") return null;
    const entries = Object.entries(row as Record<string, unknown>).filter(([k]) => k !== "_id");
    return entries[0];
  }, [docs, viz, isOutlook]);

  if (item.role === "user") {
    return (
      <div
        id={item.historyId ? `chat-turn-${item.historyId}` : undefined}
        className={cn("group flex flex-col items-end gap-1", highlighted && "scroll-mt-4")}
      >
        <div
          className={cn(
            "max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-3.5 py-2.5 text-sm text-white sm:max-w-[75%]",
            highlighted && "ring-2 ring-brand-300 ring-offset-2"
          )}
        >
          {item.text}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onRerun}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          title="Ask this question again"
        >
          <RotateCcw className="h-3 w-3" />
          Rerun
        </button>
      </div>
    );
  }

  const answerText = data?.explanation?.answer || item.text;

  return (
    <div
      id={item.historyId ? `chat-turn-${item.historyId}` : undefined}
      className={cn("flex gap-2.5", highlighted && "scroll-mt-4")}
    >
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-[10px] font-bold text-white">
        S
      </div>
      <div className={cn("min-w-0 flex-1 space-y-2.5", highlighted && "rounded-lg ring-2 ring-brand-400/40")}>
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[11px] font-semibold">Simply AI</span>
          {item.restored ? <Badge>Restored</Badge> : null}
          {isOutlook ? <Badge tone="teal">Mail</Badge> : null}
          {data?.status === "insufficient_data" ? <Badge tone="amber">Insufficient data</Badge> : null}
          {data?.status === "error" ? <Badge tone="rose">{quota ? "Quota" : "Failed"}</Badge> : null}
          {data?.status === "needs_clarification" ? <Badge tone="amber">Needs clarification</Badge> : null}
          {data?.status === "pending_approval" ? <Badge tone="teal">Approval needed</Badge> : null}
          {!isOutlook && data?.result?.truncated ? <Badge tone="rose">Truncated</Badge> : null}
        </div>

        <div className="chat-prose whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-100">{answerText}</div>

        {data?.status === "pending_approval" && data.pendingId && data.queryPlan ? (
          <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/80 p-3 dark:border-amber-900 dark:bg-amber-950/30">
            <p className="text-xs font-medium">
              {isOutlook ? "Approve this mailbox request:" : "Approve this read-only query:"}
            </p>
            <QueryPlanViewer plan={data.queryPlan} />
            <div className="flex gap-1.5">
              <Button size="sm" onClick={() => onApprove(data.pendingId!)}>
                Execute
              </Button>
              <Button size="sm" variant="outline" onClick={() => onCancel(data.pendingId!)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {data?.status === "needs_clarification" ? (
          <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <p className="text-xs font-medium">I need clarification</p>
            <ul className="mt-1.5 list-decimal pl-4 text-xs">
              {(data.queryPlan?.possibleInterpretations ?? data.queryPlan?.clarificationQuestions ?? []).map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {metric ? (
          <div className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/40">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">{metric[0]}</p>
            <p className="text-2xl font-semibold tracking-tight">{String(metric[1])}</p>
          </div>
        ) : null}

        {showRawData ? (
          <div className="space-y-2 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
            <div className="border-b border-slate-100 px-3 py-1.5 text-[11px] font-medium dark:border-slate-800">
              Data
            </div>
            <div className="space-y-2 p-2">
              <ResultChart documents={docs} visualization={viz} />
              <ResultTable documents={docs} />
            </div>
          </div>
        ) : null}

        {showHowFound ? (
          <Collapsible title="How this was found">
            {data?.explanation?.calculation ? (
              <p className="mb-2 font-mono text-xs">{data.explanation.calculation}</p>
            ) : null}
            {data?.explanation?.collectionsUsed.length || data?.queryPlan?.collectionsUsed.length ? (
              <p className="text-xs">
                <span className="font-medium">Tables / collections: </span>
                {(data.explanation?.collectionsUsed.length
                  ? data.explanation.collectionsUsed
                  : data.queryPlan?.collectionsUsed
                )?.join(", ")}
              </p>
            ) : null}
            {data?.explanation?.fieldsUsed.length || data?.queryPlan?.fieldsUsed.length ? (
              <p className="mt-1 font-mono text-[10px]">
                {(data.explanation?.fieldsUsed.length
                  ? data.explanation.fieldsUsed
                  : data.queryPlan?.fieldsUsed
                )?.join(", ")}
              </p>
            ) : null}
            {data?.explanation?.assumptions.length || data?.queryPlan?.assumptions.length ? (
              <ul className="mt-2 list-disc pl-4 text-xs text-slate-600 dark:text-slate-300">
                {(data.explanation?.assumptions.length
                  ? data.explanation.assumptions
                  : data.queryPlan?.assumptions
                )?.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            ) : null}
          </Collapsible>
        ) : null}

        {isOutlook && data?.result ? (
          <p className="text-[10px] text-slate-400">
            Based on {data.result.resultCount} email{data.result.resultCount === 1 ? "" : "s"}
            {data.result.truncated ? " (limited sample)" : ""}.
          </p>
        ) : null}

        {!isOutlook && data?.result ? (
          <p className="text-[10px] text-slate-400">
            {data.result.executionTimeMs} ms · {data.result.resultCount} rows
          </p>
        ) : null}

        {showQueryPlan && data?.queryPlan ? (
          <Collapsible title={queryPlanCollapsibleTitle(data.queryPlan)}>
            <QueryPlanViewer plan={data.queryPlan} />
          </Collapsible>
        ) : null}

        {developerMode && data ? (
          <Collapsible title="Developer Mode">
            <JsonViewer
              title="Debug"
              value={{
                provider: data.provider,
                model: data.model,
                validation: data.validation,
                developer: data.developer,
                queryPlan: data.queryPlan,
                result: data.result
              }}
            />
          </Collapsible>
        ) : null}

        {data?.status === "error" ? (
          <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/80 p-3 dark:border-amber-900 dark:bg-amber-950/30">
            {quota ? (
              <p className="text-xs text-amber-900 dark:text-amber-100">
                {data.failedModel ? `Quota used up for ${data.failedModel}.` : "Quota or rate limit hit."} Change
                the model above{suggested ? ` (try ${suggested})` : ""}, then retry.
              </p>
            ) : (
              <p className="text-xs text-amber-900 dark:text-amber-100">
                This reply failed. Retry, or change the model if it&apos;s unavailable.
              </p>
            )}
            <div className="flex flex-wrap gap-1.5">
              <Button variant="outline" size="sm" disabled={busy} onClick={onRetry}>
                <RotateCcw className="h-3 w-3" />
                Retry
              </Button>
              {quota && suggested && suggested !== currentModel ? (
                <Button size="sm" disabled={busy} onClick={() => onSwitchAndRetry(suggested)}>
                  Switch to {suggested}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {data?.canFallback && data.status === "insufficient_data" ? (
          <Button variant="outline" size="sm" onClick={onFallback}>
            Retry with fallback provider
          </Button>
        ) : null}
      </div>
    </div>
  );
}
