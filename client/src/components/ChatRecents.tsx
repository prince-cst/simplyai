import { MessageSquarePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useDeleteThread, useNewChat, useOpenThread, useSessionHistory } from "@/hooks/useHistory";
import { ApiError } from "@/types/api";

/** Light Recents panel for the chat page (left of the conversation). */
export function ChatRecents({ className }: { className?: string }) {
  const history = useSessionHistory();
  const openThread = useOpenThread();
  const deleteThread = useDeleteThread();
  const newChat = useNewChat();

  const threads = history.data?.threads ?? [];
  const activeId = history.data?.activeThreadId ?? null;

  const goNew = () => {
    newChat.mutate(undefined, {
      onSuccess: () => toast.message("New chat"),
      onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not start chat")
    });
  };

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 w-[13.5rem] shrink-0 flex-col border-r border-slate-200 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-950/40",
        className
      )}
    >
      <div className="shrink-0 border-b border-slate-200/80 p-2 dark:border-slate-800">
        <button
          type="button"
          onClick={goNew}
          disabled={newChat.isPending}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white text-[11px] font-medium text-slate-700 transition hover:border-brand-500/40 hover:bg-brand-50/50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          New chat
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        <p className="mb-1 px-1.5 text-[9px] font-semibold uppercase tracking-wider text-slate-400">
          Recents
        </p>
        {threads.length ? (
          <ul className="space-y-0.5">
            {threads.map((t) => {
              const selected = activeId === t.id;
              return (
                <li key={t.id} className="group relative">
                  <button
                    type="button"
                    title={t.title}
                    disabled={openThread.isPending}
                    onClick={() => {
                      if (selected) return;
                      openThread.mutate(t.id, {
                        onError: (e) =>
                          toast.error(e instanceof ApiError ? e.message : "Could not open chat")
                      });
                    }}
                    className={cn(
                      "w-full truncate rounded-lg py-1.5 pl-2 pr-7 text-left text-[11px] text-slate-600 transition hover:bg-white hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/80 dark:hover:text-slate-100",
                      selected &&
                        "bg-white font-medium text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100"
                    )}
                  >
                    {t.title}
                  </button>
                  <button
                    type="button"
                    aria-label="Delete chat"
                    className="absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-slate-400 opacity-0 transition hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100 dark:hover:bg-rose-950/40"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteThread.mutate(t.id, {
                        onSuccess: () => toast.message("Chat deleted"),
                        onError: (err) =>
                          toast.error(err instanceof ApiError ? err.message : "Delete failed")
                      });
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-1.5 py-4 text-[10px] leading-relaxed text-slate-400">
            Your chats will show up here. Start a conversation to create the first one.
          </p>
        )}
      </div>
    </aside>
  );
}
