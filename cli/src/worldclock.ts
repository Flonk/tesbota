/**
 * The world's calendar: eight months of four seven-day weeks, and a clock that
 * only ever moves forward by the minutes an action cost.
 */

import {
  DAY_NAMES, DAYS_PER_MONTH, DAYS_PER_WEEK, DAYS_PER_YEAR, MONTH_NAMES, WORLD_START,
} from "./config.ts";

export const MINUTES_PER_HOUR = 60;
export const HOURS_PER_DAY = 24;
export const MINUTES_PER_DAY = MINUTES_PER_HOUR * HOURS_PER_DAY;

export type Time = { era: number; year: number; day: number; minute: number; [k: string]: unknown };

export const fresh = (): Time => ({ ...WORLD_START });

export function normalise(time?: Partial<Time> | null): Time {
  const t = { ...fresh(), ...(time || {}) } as Time;
  const minute = Math.trunc(Number(t.minute) || 0);
  const day = (Math.trunc(Number(t.day) || 1)) + Math.floor(minute / MINUTES_PER_DAY);
  t.minute = ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  t.year = (Math.trunc(Number(t.year) || 0)) + Math.floor((day - 1) / DAYS_PER_YEAR);
  t.day = (((day - 1) % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR + 1;
  return t;
}

export const month = (time?: Partial<Time> | null) =>
  MONTH_NAMES[Math.floor((normalise(time).day - 1) / DAYS_PER_MONTH)];

export const dayOfMonth = (time?: Partial<Time> | null) =>
  ((normalise(time).day - 1) % DAYS_PER_MONTH) + 1;

export const weekday = (time?: Partial<Time> | null) =>
  DAY_NAMES[(normalise(time).day - 1) % DAYS_PER_WEEK];

export function ordinal(n: number): string {
  if (n % 100 >= 10 && n % 100 <= 20) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

export const date = (time?: Partial<Time> | null) =>
  `${ordinal(dayOfMonth(time))} of ${month(time)}`;

export const monthNumber = (time?: Partial<Time> | null) =>
  Math.floor((normalise(time).day - 1) / DAYS_PER_MONTH) + 1;

export function advance(time: Partial<Time> | null | undefined, minutes: unknown): Time {
  const t = normalise(time);
  t.minute += Math.trunc(Number(minutes) || 0);
  return normalise(t);
}

export function clock(time?: Partial<Time> | null): string {
  const t = normalise(time);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(t.minute / MINUTES_PER_HOUR))}:${pad(t.minute % MINUTES_PER_HOUR)}`;
}

export function stamp(time?: Partial<Time> | null): string {
  const t = normalise(time);
  return `${dayOfMonth(t)} ${month(t)} ${t.era}E${t.year}, ${clock(t)}`;
}

/** Rewrite a stored stamp — `1 Frostfall 4E202, 14:12` — as `1.1. 4E202`. */
export function shorten(stampText: unknown): string {
  const head = String(stampText ?? "").split(",")[0].trim();
  const parts = head.split(/\s+/);
  if (parts.length !== 3 || !MONTH_NAMES.includes(parts[1])) return head || "—";
  return `${parts[0]}.${MONTH_NAMES.indexOf(parts[1]) + 1}. ${parts[2]}`;
}

export function longStamp(time?: Partial<Time> | null): string {
  const t = normalise(time);
  return `${weekday(t)}, ${date(t)}, ${t.era}E${t.year}, ${clock(t)}`;
}

export function partOfDay(time?: Partial<Time> | null): string {
  const hour = Math.floor(normalise(time).minute / MINUTES_PER_HOUR);
  if (hour < 5) return "the small hours";
  if (hour < 8) return "early morning";
  if (hour < 12) return "morning";
  if (hour < 14) return "midday";
  if (hour < 18) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}
