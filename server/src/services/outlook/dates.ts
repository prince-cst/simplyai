/** Convert a calendar day in `timeZone` to a UTC Date at local midnight. */
export function startOfDayInTimeZone(timeZone: string, now = new Date()): Date {
  const dateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);

  const asUtc = new Date(`${dateStr}T00:00:00.000Z`);
  const offset = timeZoneOffsetMs(asUtc, timeZone);
  let localMidnight = new Date(asUtc.getTime() - offset);
  const offset2 = timeZoneOffsetMs(localMidnight, timeZone);
  if (offset2 !== offset) {
    localMidnight = new Date(asUtc.getTime() - offset2);
  }
  return localMidnight;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour === "24" ? "0" : map.hour),
    Number(map.minute),
    Number(map.second)
  );
  return asUtc - date.getTime();
}
