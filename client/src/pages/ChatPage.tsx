import { ChatWindow } from "@/components/ChatWindow";
import { ChatModelSwitcher } from "@/components/ChatModelSwitcher";
import { ChatRecents } from "@/components/ChatRecents";
import { useMongoStatus } from "@/hooks/useMongo";
import { engineLabel, isOutlookEngine, isQuickBooksEngine } from "@/lib/engines";

export function ChatPage() {
  const status = useMongoStatus();
  const engine = status.data?.engine;
  const name = status.data?.connectionName ?? status.data?.database;
  const source = status.data?.connected
    ? isOutlookEngine(engine)
      ? `Outlook${name ? ` · ${name}` : ""}`
      : isQuickBooksEngine(engine)
        ? `QuickBooks${name ? ` · ${name}` : ""}`
        : `${engineLabel(engine)}${name ? ` · ${name}` : ""}`
    : null;

  return (
    <div className="flex h-[calc(100vh-2.75rem)] bg-white dark:bg-[#0b0f14]">
      {/* Recents panel — left of conversation (ChatGPT-style) */}
      <ChatRecents className="hidden sm:flex" />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-3 dark:border-slate-800/80">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium">Chat</p>
            <p className="truncate text-[10px] text-slate-400">
              {source ? `Asking ${source}` : "Connect a source, then ask anything"}
            </p>
          </div>
          <ChatModelSwitcher />
        </div>
        <div className="min-h-0 flex-1">
          <ChatWindow />
        </div>
      </div>
    </div>
  );
}
