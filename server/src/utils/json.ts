export function parseJsonFromText(text: string): unknown {
  const trimmed = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\|.*?\|>/g, "")
    .trim();
  if (!trimmed) {
    throw new Error("Empty model response");
  }

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fence?.[1] ?? trimmed).trim();

  try {
    return JSON.parse(candidate);
  } catch {
    const startObj = candidate.indexOf("{");
    const startArr = candidate.indexOf("[");
    let start = -1;
    if (startObj === -1) start = startArr;
    else if (startArr === -1) start = startObj;
    else start = Math.min(startObj, startArr);
    if (start === -1) {
      throw new Error("Model response was not valid JSON");
    }
    const endObj = candidate.lastIndexOf("}");
    const endArr = candidate.lastIndexOf("]");
    const end = Math.max(endObj, endArr);
    if (end <= start) {
      throw new Error("Model response was not valid JSON");
    }
    return JSON.parse(candidate.slice(start, end + 1));
  }
}

export function safeJsonStringify(value: unknown, space = 2): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v === "bigint") return v.toString();
    if (v instanceof Date) return v.toISOString();
    return v;
  }, space);
}
