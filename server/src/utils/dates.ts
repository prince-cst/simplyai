import type { DateRangeKey } from "../types/index.js";

export interface DateRange {
  start: Date;
  end: Date;
  label: string;
  key: DateRangeKey;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const parts = dtf.formatToParts(date);
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second")
  };
}

export function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): Date {
  const desired = Date.UTC(year, month - 1, day, hour, minute, second);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const asUtcWall = (ms: number): number => {
    const parts = dtf.formatToParts(new Date(ms));
    const get = (type: string): number =>
      Number(parts.find((p) => p.type === type)?.value ?? 0);
    return Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second")
    );
  };
  let guess = desired;
  for (let i = 0; i < 4; i += 1) {
    guess += desired - asUtcWall(guess);
  }
  return new Date(guess);
}

export function startOfZonedDay(date: Date, timeZone: string): Date {
  const p = getZonedParts(date, timeZone);
  return zonedDateTimeToUtc(p.year, p.month, p.day, 0, 0, 0, timeZone);
}

function startOfZonedMonth(year: number, month: number, timeZone: string): Date {
  return zonedDateTimeToUtc(year, month, 1, 0, 0, 0, timeZone);
}

function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

function isoWeekStart(date: Date, timeZone: string): Date {
  const start = startOfZonedDay(date, timeZone);
  const p = getZonedParts(start, timeZone);
  const asDate = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const day = asDate.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(Date.UTC(p.year, p.month - 1, p.day - diff));
  return zonedDateTimeToUtc(
    monday.getUTCFullYear(),
    monday.getUTCMonth() + 1,
    monday.getUTCDate(),
    0,
    0,
    0,
    timeZone
  );
}

export function currentDateContext(timeZone: string, now = new Date()): Record<string, unknown> {
  const p = getZonedParts(now, timeZone);
  const todayStart = startOfZonedDay(now, timeZone);
  return {
    timezone: timeZone,
    nowIsoUtc: now.toISOString(),
    localNow: `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}:${String(p.second).padStart(2, "0")}`,
    localDate: `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`,
    year: p.year,
    month: p.month,
    day: p.day,
    todayStartUtc: todayStart.toISOString(),
    note: "Backend resolves semantic date ranges (this_month, last_month, etc.) in the application timezone. Prefer dateIntents over hard-coded dates."
  };
}

export function resolveDateRange(
  key: DateRangeKey,
  timeZone: string,
  now = new Date()
): DateRange {
  const p = getZonedParts(now, timeZone);
  const todayStart = startOfZonedDay(now, timeZone);
  const tomorrowStart = addDaysUtcByZonedCalendar(todayStart, 1, timeZone);

  const monthStart = startOfZonedMonth(p.year, p.month, timeZone);
  const nextMonth = addMonths(p.year, p.month, 1);
  const nextMonthStart = startOfZonedMonth(nextMonth.year, nextMonth.month, timeZone);
  const prevMonth = addMonths(p.year, p.month, -1);
  const prevMonthStart = startOfZonedMonth(prevMonth.year, prevMonth.month, timeZone);

  const yearStart = startOfZonedMonth(p.year, 1, timeZone);
  const nextYearStart = startOfZonedMonth(p.year + 1, 1, timeZone);
  const lastYearStart = startOfZonedMonth(p.year - 1, 1, timeZone);

  const weekStart = isoWeekStart(now, timeZone);
  const nextWeekStart = addDaysUtcByZonedCalendar(weekStart, 7, timeZone);
  const lastWeekStart = addDaysUtcByZonedCalendar(weekStart, -7, timeZone);

  const range = (start: Date, end: Date, label: string): DateRange => ({
    start,
    end,
    label,
    key
  });

  switch (key) {
    case "today":
      return range(todayStart, tomorrowStart, "today");
    case "yesterday": {
      const y = addDaysUtcByZonedCalendar(todayStart, -1, timeZone);
      return range(y, todayStart, "yesterday");
    }
    case "this_week":
      return range(weekStart, nextWeekStart, "this week");
    case "last_week":
      return range(lastWeekStart, weekStart, "last week");
    case "this_month":
      return range(monthStart, nextMonthStart, "this month");
    case "last_month":
      return range(prevMonthStart, monthStart, "last month");
    case "this_year":
      return range(yearStart, nextYearStart, "this year");
    case "last_year":
      return range(lastYearStart, yearStart, "last year");
    case "q1":
      return range(startOfZonedMonth(p.year, 1, timeZone), startOfZonedMonth(p.year, 4, timeZone), "Q1");
    case "q2":
      return range(startOfZonedMonth(p.year, 4, timeZone), startOfZonedMonth(p.year, 7, timeZone), "Q2");
    case "q3":
      return range(startOfZonedMonth(p.year, 7, timeZone), startOfZonedMonth(p.year, 10, timeZone), "Q3");
    case "q4":
      return range(startOfZonedMonth(p.year, 10, timeZone), startOfZonedMonth(p.year + 1, 1, timeZone), "Q4");
    case "january":
    case "february":
    case "march":
    case "april":
    case "may":
    case "june":
    case "july":
    case "august":
    case "september":
    case "october":
    case "november":
    case "december": {
      const monthNum = monthNameToNumber(key);
      const start = startOfZonedMonth(p.year, monthNum, timeZone);
      const nm = addMonths(p.year, monthNum, 1);
      return range(start, startOfZonedMonth(nm.year, nm.month, timeZone), key);
    }
    case "last_7_days":
      return range(addDaysUtcByZonedCalendar(todayStart, -7, timeZone), tomorrowStart, "last 7 days");
    case "last_30_days":
      return range(addDaysUtcByZonedCalendar(todayStart, -30, timeZone), tomorrowStart, "last 30 days");
    case "last_90_days":
      return range(addDaysUtcByZonedCalendar(todayStart, -90, timeZone), tomorrowStart, "last 90 days");
    default: {
      const _exhaustive: never = key;
      return range(todayStart, tomorrowStart, String(_exhaustive));
    }
  }
}

function addDaysUtcByZonedCalendar(start: Date, days: number, timeZone: string): Date {
  const p = getZonedParts(start, timeZone);
  const utcDate = Date.UTC(p.year, p.month - 1, p.day);
  const shifted = new Date(utcDate + days * 24 * 60 * 60 * 1000);
  return zonedDateTimeToUtc(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    0,
    0,
    0,
    timeZone
  );
}

function monthNameToNumber(name: DateRangeKey): number {
  const map: Record<string, number> = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12
  };
  return map[name] ?? 1;
}

export type DateBoundStorage = "bsonDate" | "dateString" | "isoString";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Format a range bound for string-stored calendar dates (YYYY-MM-DD) in the app timezone. */
export function formatDateOnlyBound(date: Date, timeZone: string): string {
  const p = getZonedParts(date, timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/**
 * Build a MongoDB $gte/$lt clause for a resolved date range.
 * Use dateString/isoString when the field is stored as a string — comparing BSON Date
 * to string values matches nothing in MongoDB.
 */
export function bsonDateFilter(
  range: DateRange,
  storage: DateBoundStorage = "bsonDate",
  timeZone = "UTC"
): Record<string, Date | string> {
  if (storage === "dateString") {
    return {
      $gte: formatDateOnlyBound(range.start, timeZone),
      $lt: formatDateOnlyBound(range.end, timeZone)
    };
  }
  if (storage === "isoString") {
    return {
      $gte: range.start.toISOString(),
      $lt: range.end.toISOString()
    };
  }
  return { $gte: range.start, $lt: range.end };
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_LIKE_RE = /^\d{4}-\d{2}-\d{2}T/;

function valueLooksLikeDateOnly(value: unknown): boolean {
  return typeof value === "string" && DATE_ONLY_RE.test(value.trim());
}

function valueLooksLikeIso(value: unknown): boolean {
  return typeof value === "string" && ISO_LIKE_RE.test(value.trim());
}

function readPath(doc: Record<string, unknown>, path: string): unknown {
  if (!path.includes(".")) return doc[path];
  let cur: unknown = doc;
  for (const part of path.split(".")) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/**
 * Decide how date-intent bounds should be encoded for a schema field.
 * String-stored dates (common for endDate/startDate as "YYYY-MM-DD") must not use BSON Date.
 */
export function resolveDateBoundStorage(input: {
  fieldType?: string;
  typesSeen?: string[];
  isPossibleDate?: boolean;
  enumSamples?: string[];
  sampleValues?: unknown[];
}): DateBoundStorage {
  const samples = [
    ...(input.enumSamples ?? []),
    ...(input.sampleValues ?? [])
  ];
  if (samples.some((v) => v instanceof Date)) return "bsonDate";
  if (samples.some(valueLooksLikeDateOnly)) return "dateString";
  if (samples.some(valueLooksLikeIso)) return "isoString";

  const types = new Set(
    [input.fieldType, ...(input.typesSeen ?? [])].filter(Boolean) as string[]
  );
  if (types.has("date") && !types.has("string")) return "bsonDate";
  if (types.has("string") || input.isPossibleDate) return "dateString";
  if (types.has("date")) return "bsonDate";
  return "bsonDate";
}

export function sampleValuesForField(
  sampleDocuments: Record<string, unknown>[] | undefined,
  fieldPath: string,
  limit = 20
): unknown[] {
  if (!sampleDocuments?.length) return [];
  const out: unknown[] = [];
  for (const doc of sampleDocuments) {
    const v = readPath(doc, fieldPath);
    if (v !== undefined && v !== null) {
      out.push(v);
      if (out.length >= limit) break;
    }
  }
  return out;
}
