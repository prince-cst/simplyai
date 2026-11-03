import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "outline";
  size?: "sm" | "md" | "icon";
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" && "h-7 px-2 text-[11px]",
        size === "md" && "h-8 px-3 text-xs",
        size === "icon" && "h-8 w-8 p-0",
        variant === "primary" && "bg-brand-600 text-white hover:bg-brand-700 shadow-sm",
        variant === "secondary" &&
          "bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900",
        variant === "ghost" && "hover:bg-slate-100 dark:hover:bg-slate-800/80",
        variant === "danger" && "bg-rose-600 text-white hover:bg-rose-700",
        variant === "outline" &&
          "border border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-transparent dark:hover:bg-slate-800/60",
        className
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-8 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs outline-none ring-brand-600/20 focus:border-brand-500 focus:ring-2 dark:border-slate-700 dark:bg-slate-950",
        className
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-8 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs outline-none ring-brand-600/20 focus:border-brand-500 focus:ring-2 dark:border-slate-700 dark:bg-slate-950",
        className
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-brand-600/20 focus:border-brand-500 focus:ring-2 dark:border-slate-700 dark:bg-slate-950",
        className
      )}
      {...props}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-200/90 bg-white p-3 dark:border-slate-800 dark:bg-slate-900/50",
        className
      )}
    >
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = "slate"
}: {
  children: ReactNode;
  tone?: "slate" | "green" | "amber" | "rose" | "teal";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium",
        tone === "slate" && "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
        tone === "green" && "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
        tone === "amber" && "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
        tone === "rose" && "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
        tone === "teal" && "bg-brand-50 text-brand-700 dark:bg-teal-950 dark:text-teal-300"
      )}
    >
      {children}
    </span>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-base font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800", className)} />;
}

/** Compact section label used instead of heavy card headers */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("text-[10px] font-semibold uppercase tracking-wider text-slate-400", className)}>
      {children}
    </p>
  );
}
