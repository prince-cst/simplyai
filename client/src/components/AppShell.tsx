import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Database,
  LayoutDashboard,
  MessageSquare,
  Settings,
  FlaskConical,
  Table2,
  Menu,
  Moon,
  Sun,
  Bell,
  X
} from "lucide-react";
import { Toaster } from "sonner";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/uiStore";
import { useMongoStatus } from "@/hooks/useMongo";
import { Button } from "@/components/ui";
import { EntitySwitcher } from "@/components/EntitySwitcher";
import { isOutlookEngine, isQuickBooksEngine, engineLabel } from "@/lib/engines";

const NAV_DATA = [
  { to: "/connections", label: "Connections", icon: Database },
  { to: "/explorer", label: "Explorer", icon: Table2 },
  { to: "/triggers", label: "Triggers", icon: Bell }
];

const NAV_MORE = [
  { to: "/", label: "Home", icon: LayoutDashboard },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/tests", label: "Tests", icon: FlaskConical }
];

function NavItem({ to, label, icon: Icon, end }: { to: string; label: string; icon: typeof MessageSquare; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] font-medium text-slate-400 transition hover:bg-white/5 hover:text-slate-100",
          isActive && "bg-brand-600/20 text-white"
        )
      }
    >
      <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" />
      {label}
    </NavLink>
  );
}

export function AppShell() {
  const { sidebarOpen, toggleSidebar, dark, toggleDark } = useUiStore();
  const status = useMongoStatus();
  const location = useLocation();
  const engine = status.data?.engine;
  const activeLabel = status.data?.connectionName ?? status.data?.database;
  const isChat = location.pathname === "/chat";

  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", dark);
  }

  return (
    <div className="h-full min-h-screen bg-[var(--color-surface)] text-slate-900 dark:bg-[var(--color-surface-dark)] dark:text-slate-100">
      <Toaster richColors position="top-right" toastOptions={{ className: "text-xs" }} />
      <div className="flex h-full min-h-screen">
        {sidebarOpen ? (
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-20 bg-black/40 lg:hidden"
            onClick={toggleSidebar}
          />
        ) : null}

        <aside
          className={cn(
            "fixed z-30 flex h-full w-[13.5rem] shrink-0 flex-col border-r border-slate-800/80 bg-[#0c1118] text-slate-100 transition-transform lg:static",
            sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
            !sidebarOpen && "lg:hidden"
          )}
        >
          <div className="flex h-11 items-center justify-between gap-2 border-b border-slate-800/80 px-3">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-600 text-[10px] font-bold tracking-tight">
                S
              </div>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold leading-tight tracking-tight">Simply AI</p>
                <p className="truncate text-[9px] text-slate-500">Ask your data</p>
              </div>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 lg:hidden" onClick={toggleSidebar}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
            <div>
              <p className="mb-1 px-2 text-[9px] font-semibold uppercase tracking-wider text-slate-600">Chat</p>
              <NavItem to="/chat" label="Chat" icon={MessageSquare} />
            </div>
            <div className="mt-3">
              <p className="mb-1 px-2 text-[9px] font-semibold uppercase tracking-wider text-slate-600">Data</p>
              <div className="space-y-0.5">
                {NAV_DATA.map((item) => (
                  <NavItem key={item.to} {...item} />
                ))}
              </div>
            </div>
            <div className="mt-3">
              <p className="mb-1 px-2 text-[9px] font-semibold uppercase tracking-wider text-slate-600">More</p>
              <div className="space-y-0.5">
                {NAV_MORE.map((item) => (
                  <NavItem key={item.to} {...item} end={item.to === "/"} />
                ))}
              </div>
            </div>
          </nav>

          <div className="border-t border-slate-800/80 px-3 py-2.5 text-[10px] text-slate-500">
            {status.data?.connected ? (
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                <p className="truncate">
                  {activeLabel}
                  {engine ? ` · ${engineLabel(engine)}` : ""}
                  {status.data.needsDatabaseSelection ? " · pick DB" : ""}
                </p>
              </div>
            ) : status.data?.connections?.length ? (
              <p>{status.data.connections.length} saved · offline</p>
            ) : (
              <p>Not connected</p>
            )}
          </div>
        </aside>

        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-11 shrink-0 items-center justify-between gap-2 border-b border-slate-200/80 bg-white/90 px-2.5 backdrop-blur dark:border-slate-800 dark:bg-[#0c1118]/90">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Button variant="ghost" size="icon" className="h-7 w-7 lg:hidden" onClick={toggleSidebar}>
                <Menu className="h-4 w-4" />
              </Button>
              <EntitySwitcher compact />
              {status.data?.connected && isQuickBooksEngine(engine) ? (
                <span className="hidden rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 sm:inline">
                  QuickBooks
                </span>
              ) : null}
              {status.data?.connected && isOutlookEngine(engine) ? (
                <span className="hidden rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-950 dark:text-sky-300 sm:inline">
                  Outlook
                </span>
              ) : null}
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggleDark} aria-label="Toggle dark mode">
              {dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </Button>
          </header>
          <main className={cn("min-h-0 flex-1", isChat ? "overflow-hidden p-0" : "overflow-auto p-3 sm:p-4")}>
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
