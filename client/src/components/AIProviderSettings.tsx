import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Badge, Button, Card, Input, Select } from "@/components/ui";
import { useAiModels, useSettings, useUpdateSettings } from "@/hooks/useSettings";
import type { AIProviderName } from "@/types/api";
import { ApiError } from "@/types/api";

const PROVIDERS: { id: AIProviderName; label: string }[] = [
  { id: "ollama", label: "Ollama" },
  { id: "gemini", label: "Google Gemini" },
  { id: "groq", label: "Groq" }
];

export function AIProviderSettings() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const data = settings.data;
  const [geminiKey, setGeminiKey] = useState("");
  const [groqKey, setGroqKey] = useState("");
  const [testMsg, setTestMsg] = useState<string>("");
  const models = useAiModels(data?.provider);

  if (!data) return <Card>Loading settings…</Card>;

  const save = (body: Record<string, unknown>) => {
    update.mutate(body, {
      onSuccess: () => toast.success("Settings saved"),
      onError: (e) => toast.error(e instanceof ApiError ? e.message : "Save failed")
    });
  };

  const test = async (provider: AIProviderName) => {
    setTestMsg("Testing…");
    try {
      const result = await api<{
        ok: boolean;
        message: string;
        latencyMs: number;
        details?: { error?: string; hints?: string[]; testReply?: string };
      }>("/ai/test", { method: "POST", body: JSON.stringify({ provider }) });
      const hints = result.details?.hints?.length ? `\n\n${result.details.hints.map((h) => `- ${h}`).join("\n")}` : "";
      const extra =
        result.details?.error && result.details.error !== result.message ? `\n${result.details.error}` : "";
      setTestMsg(
        `${result.ok ? "✓" : "✗"} ${result.message}${extra}${hints}\n\nResponse time: ${(result.latencyMs / 1000).toFixed(2)} sec`
      );
      if (result.ok) toast.success(`${provider} connected`);
      else toast.error(result.message.slice(0, 180));
    } catch (error) {
      const err = error instanceof ApiError ? error : new ApiError("Test failed");
      setTestMsg(`✗ ${err.message}`);
    }
  };

  return (
    <Card className="space-y-5">
      <div>
        <h3 className="font-medium">AI Provider</h3>
        <div className="mt-3 flex flex-col gap-2">
          {PROVIDERS.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="provider"
                checked={data.provider === p.id}
                onChange={() => save({ provider: p.id })}
              />
              {p.label}
            </label>
          ))}
        </div>
      </div>

      {data.provider === "ollama" ? (
        <div className="space-y-3">
          <label className="block text-sm">
            Base URL
            <Input
              className="mt-1"
              defaultValue={data.ollama.baseUrl}
              onBlur={(e) => save({ ollama: { baseUrl: e.target.value } })}
            />
          </label>
          <label className="block text-sm">
            Model
            <Input
              className="mt-1"
              list="ollama-models"
              defaultValue={data.ollama.model}
              onBlur={(e) => save({ ollama: { model: e.target.value } })}
            />
            <datalist id="ollama-models">
              {models.data?.models.map((m) => (
                <option key={m.id} value={m.id} />
              ))}
            </datalist>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void models.refetch()}>
              Fetch Models / Refresh Models
            </Button>
            <Button onClick={() => void test("ollama")}>Test Connection</Button>
          </div>
        </div>
      ) : null}

      {data.provider === "gemini" ? (
        <div className="space-y-3">
          <label className="block text-sm">
            API Key {data.gemini.hasApiKey ? <Badge tone="green">saved server-side</Badge> : null}
            <Input
              className="mt-1"
              type="password"
              placeholder={data.gemini.hasApiKey ? "•••••••• (enter to replace)" : "Paste Gemini API key"}
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
            />
          </label>
          <Button
            variant="outline"
            size="sm"
            disabled={!geminiKey}
            onClick={() => {
              save({ gemini: { apiKey: geminiKey } });
              setGeminiKey("");
            }}
          >
            Save API key
          </Button>
          <label className="block text-sm">
            Free-tier model
            <Select
              className="mt-1"
              value={data.gemini.model}
              onChange={(e) => save({ gemini: { model: e.target.value } })}
            >
              {(models.data?.models.length
                ? models.data.models
                : [
                    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash (recommended)" },
                    { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
                    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
                    { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash" },
                    { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite" },
                    { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash (20 free requests/day)" }
                  ]
              ).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name || m.id}
                </option>
              ))}
            </Select>
          </label>
          <p className="text-xs text-slate-500">
            Only Google AI Studio <strong>free-tier</strong> models are listed. Gemini 3.6 Flash allows about 20 free
            requests per day. If that quota is used up, Chat shows a warning — switch the model there and click{" "}
            <strong>Retry this question</strong>.
          </p>
          <p className="text-xs text-slate-500">
            Click <strong>Save API key</strong> before Test. New AI Studio keys start with <code>AQ.</code> — that is expected.
          </p>
          <Button onClick={() => void test("gemini")}>Test Gemini</Button>
        </div>
      ) : null}

      {data.provider === "groq" ? (
        <div className="space-y-3">
          <label className="block text-sm">
            API Key {data.groq.hasApiKey ? <Badge tone="green">saved server-side</Badge> : null}
            <Input
              className="mt-1"
              type="password"
              placeholder={data.groq.hasApiKey ? "•••••••• (enter to replace)" : "Paste Groq API key"}
              value={groqKey}
              onChange={(e) => setGroqKey(e.target.value)}
            />
          </label>
          <Button
            variant="outline"
            size="sm"
            disabled={!groqKey}
            onClick={() => {
              save({ groq: { apiKey: groqKey } });
              setGroqKey("");
            }}
          >
            Save API key
          </Button>
          <label className="block text-sm">
            Model
            <Input
              className="mt-1"
              defaultValue={data.groq.model}
              onBlur={(e) => save({ groq: { model: e.target.value } })}
            />
          </label>
          <Button onClick={() => void test("groq")}>Test Groq</Button>
        </div>
      ) : null}

      <label className="block text-sm">
        Optional fallback provider
        <select
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
          value={data.fallbackProvider ?? ""}
          onChange={(e) => save({ fallbackProvider: e.target.value || null })}
        >
          <option value="">None</option>
          {PROVIDERS.filter((p) => p.id !== data.provider).map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-slate-500">Fallback is never used silently. You must confirm in Chat.</p>
      </label>

      {testMsg ? (
        <pre className="whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800">{testMsg}</pre>
      ) : null}
    </Card>
  );
}
