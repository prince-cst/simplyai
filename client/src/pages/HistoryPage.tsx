import { useNavigate } from "react-router-dom";
import { MessageSquare } from "lucide-react";
import { Button, PageHeader } from "@/components/ui";
import { useClearHistory, useResumeChat, useSessionHistory } from "@/hooks/useHistory";
import { messagesFromChatTurns } from "@/lib/chatTranscript";
import { useChatStore } from "@/stores/chatStore";
import { cn, formatDate } from "@/lib/utils";
import { toast } from "sonner";

export function HistoryPage() {
  const navigate = useNavigate();
  const history = useSessionHistory();
  const clear = useClearHistory();
  const resume = useResumeChat();
  const setMessages = useChatStore((s) => s.setMessages);
  const items = history.data?.history ?? [];

  const openChat = (id?: string) => {
    const go = () => navigate(id ? `/chat?resume=${encodeURIComponent(id)}` : "/chat");
    if ((history.data?.chat.length ?? 0) > 0) {
      go();
      return;
    }
    resume.mutate(undefined, {
      onSuccess: (data) => {
        setMessages(messagesFromChatTurns(data.chat, data.history));
        toast.message("Restored conversation from history");
        go();
      },
      onError: () => {
        toast.error("Could not restore chat");
        go();
      }
    });
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="History"
        subtitle="Past Q&A for this source. New chat clears the thread but keeps this list."
        actions={
          <div className="flex flex-wrap gap-1.5">
            {items.length ? (
              <Button size="sm" onClick={() => openChat()}>
                <MessageSquare className="h-3.5 w-3.5" />
                Continue
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                clear.mutate(undefined, {
                  onSuccess: () => toast.message("History cleared")
                })
              }
              disabled={!items.length || clear.isPending}
            >
              Clear
            </Button>
          </div>
        }
      />
      <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
        {items.map((item, i) => (
          <div
            key={item.id}
            className={cn(
              "flex flex-col gap-2 p-3 transition hover:bg-slate-50 sm:flex-row sm:items-start sm:justify-between dark:hover:bg-slate-900/50",
              i > 0 && "border-t border-slate-100 dark:border-slate-800"
            )}
          >
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openChat(item.id)}>
              <p className="text-xs font-medium">{item.question}</p>
              {item.answer ? (
                <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{item.answer}</p>
              ) : null}
              <p className="mt-1 text-[9px] text-slate-400">
                {formatDate(item.timestamp)} · {item.provider}/{item.model} · {item.executionTimeMs} ms ·{" "}
                {item.success ? "ok" : "failed"}
              </p>
            </button>
            <Button variant="outline" size="sm" className="shrink-0" onClick={() => openChat(item.id)}>
              Open
            </Button>
          </div>
        ))}
        {!items.length ? (
          <p className="px-3 py-8 text-center text-xs text-slate-400">No queries yet. Ask a question in Chat first.</p>
        ) : null}
      </div>
    </div>
  );
}
