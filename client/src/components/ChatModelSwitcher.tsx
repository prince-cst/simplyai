import { toast } from "sonner";
import { Select } from "@/components/ui";
import { useAiModels, useSettings, useUpdateSettings } from "@/hooks/useSettings";
import { ApiError } from "@/types/api";

export function ChatModelSwitcher() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const data = settings.data;
  const models = useAiModels(data?.provider);

  if (!data) return null;

  const geminiModels =
    data.provider === "gemini"
      ? models.data?.models.length
        ? models.data.models
        : [
            { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash (recommended)" },
            { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
            { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
            { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash (20 free requests/day)" }
          ]
      : [];

  const current =
    data.provider === "gemini" ? data.gemini.model : data.provider === "ollama" ? data.ollama.model : data.groq.model;

  const onChange = (model: string) => {
    if (!model || model === current) return;
    const body =
      data.provider === "gemini"
        ? { gemini: { model } }
        : data.provider === "ollama"
          ? { ollama: { model } }
          : { groq: { model } };
    update.mutate(body, {
      onSuccess: () =>
        toast.success(`Model changed to ${model}`, {
          description: "Click Retry on a failed message to run that question again."
        }),
      onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not change model")
    });
  };

  const options =
    data.provider === "gemini"
      ? geminiModels
      : data.provider === "ollama"
        ? models.data?.models ?? []
        : [{ id: data.groq.model, name: data.groq.model }];

  return (
    <label className="flex min-w-[9rem] max-w-[14rem] items-center gap-1.5 text-xs">
      <span className="hidden shrink-0 text-[10px] font-medium text-slate-400 sm:inline">Model</span>
      <Select
        className="h-7 py-0 text-[11px]"
        value={current}
        disabled={update.isPending}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name || item.id}
          </option>
        ))}
        {current && !options.some((item) => item.id === current) ? (
          <option value={current}>{current}</option>
        ) : null}
      </Select>
    </label>
  );
}
