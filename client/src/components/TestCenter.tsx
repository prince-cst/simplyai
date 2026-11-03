import { useState } from "react";
import { api } from "@/lib/api";
import { Badge, Button, Card } from "@/components/ui";
import type { TestResult } from "@/types/api";
import { ApiError } from "@/types/api";

const TESTS = [
  { id: "mongodb", label: "Test MongoDB Connection" },
  { id: "schema", label: "Test Schema Introspection" },
  { id: "ollama", label: "Test Ollama" },
  { id: "gemini", label: "Test Gemini" },
  { id: "groq", label: "Test Groq" },
  { id: "simple-ai", label: "Test Simple AI Query" },
  { id: "query", label: "Test MongoDB Query Execution" }
];

export function TestCenter() {
  const [results, setResults] = useState<TestResult[]>([]);
  const [running, setRunning] = useState<string | null>(null);

  const run = async (which: string) => {
    setRunning(which);
    try {
      const data = await api<{ results: TestResult[] }>(`/tests/run?which=${which}`, { method: "POST" });
      setResults(data.results);
    } catch (error) {
      const err = error instanceof ApiError ? error : new ApiError("Test failed");
      setResults([{ name: which, ok: false, message: err.message }]);
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {TESTS.map((t) => (
          <Button key={t.id} variant="outline" disabled={running !== null} onClick={() => void run(t.id)}>
            {t.label}
          </Button>
        ))}
        <Button disabled={running !== null} onClick={() => void run("all")}>
          Run all
        </Button>
      </div>
      {running ? <p className="text-sm text-slate-500">Running {running}…</p> : null}
      <div className="space-y-3">
        {results.map((r) => (
          <Card key={r.name}>
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium">{r.name}</p>
              <Badge tone={r.ok ? "green" : "rose"}>{r.ok ? "✓ PASS" : "✗ FAIL"}</Badge>
            </div>
            <pre className="mt-2 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">{r.message}</pre>
          </Card>
        ))}
      </div>
    </div>
  );
}
