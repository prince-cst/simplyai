import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { copyText } from "@/lib/utils";
import { Button } from "@/components/ui";

export function JsonViewer({ value, title }: { value: unknown; title?: string }) {
  const [copied, setCopied] = useState(false);
  const text = JSON.stringify(value, null, 2);
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-950 text-slate-100 dark:border-slate-800">
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2 text-xs text-slate-400">
        <span>{title ?? "JSON"}</span>
        <Button
          size="sm"
          variant="ghost"
          className="text-slate-300 hover:bg-slate-800"
          onClick={async () => {
            await copyText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          Copy
        </Button>
      </div>
      <pre className="max-h-[420px] overflow-auto p-4 font-mono text-xs leading-relaxed">{text}</pre>
    </div>
  );
}

export function Collapsible({
  title,
  children,
  defaultOpen = false
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-medium"
        onClick={() => setOpen((v) => !v)}
      >
        {title}
        <span className="text-slate-400">{open ? "▾" : "▸"}</span>
      </button>
      {open ? <div className="border-t border-slate-200 p-4 dark:border-slate-800">{children}</div> : null}
    </div>
  );
}
