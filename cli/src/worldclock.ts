/**
 * The world's calendar: eight months of four seven-day weeks, and a clock that
 * only ever moves forward by the minutes an action cost.
 *
 * How long the year is does not live here — it is however long terra takes to go
 * round, solved in `sky.ts` from the mass it orbits and the distance it keeps.
 * The months and the weeks do live here, because those are something people did
 * to a year rather than something a year does. `tesbota check` holds the two
 * together: eight months of twenty-eight days have to come to exactly one orbit,
 * or the calendar has stopped describing the sky and says so.
 */

import * as sky from "./sky.ts";
import {
  DAY_NAMES, DAYS_PER_MONTH, DAYS_PER_WEEK, MONTH_NAMES, WORLD_START,
} from "./config.ts";
import type { TimeT } from "./schema.ts";

/** How many days terra takes to come back round to where it started. */
export const yearDays = () => sky.calendar().days;

export const MINUTES_PER_HOUR = 60;
export const HOURS_PER_DAY = 24;
export const MINUTES_PER_DAY = MINUTES_PER_HOUR * HOURS_PER_DAY;


export const fresh = (): TimeT => ({ ...WORLD_START });

export function normalise(time?: Partial<TimeT> | null): TimeT {
  const t = { ...fresh(), ...(time || {}) } as TimeT;
  const minute = Math.trunc(Number(t.minute) || 0);
  const day = (Math.trunc(Number(t.day) || 1)) + Math.floor(minute / MINUTES_PER_DAY);
  t.minute = ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const inYear = yearDays();
  t.year = (Math.trunc(Number(t.year) || 0)) + Math.floor((day - 1) / inYear);
  t.day = (((day - 1) % inYear) + inYear) % inYear + 1;
  return t;
}

// A year the sky has made longer than the months can tile spills into the last
// of them rather than off the end of the list — a wrong month name is a wrong
// date, and `check` is already shouting about it.
export const month = (time?: Partial<TimeT> | null) =>
  MONTH_NAMES[
    Math.min(MONTH_NAMES.length - 1, Math.floor((normalise(time).day - 1) / DAYS_PER_MONTH))
  ];

export const dayOfMonth = (time?: Partial<TimeT> | null) =>
  ((normalise(time).day - 1) % DAYS_PER_MONTH) + 1;

export const weekday = (time?: Partial<TimeT> | null) =>
  DAY_NAMES[(normalise(time).day - 1) % DAYS_PER_WEEK];

export function ordinal(n: number): string {
  if (n % 100 >= 10 && n % 100 <= 20) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

export const date = (time?: Partial<TimeT> | null) =>
  `${ordinal(dayOfMonth(time))} of ${month(time)}`;

export const monthNumber = (time?: Partial<TimeT> | null) =>
  Math.floor((normalise(time).day - 1) / DAYS_PER_MONTH) + 1;

export function advance(time: Partial<TimeT> | null | undefined, minutes: unknown): TimeT {
  const t = normalise(time);
  t.minute += Math.trunc(Number(minutes) || 0);
  return normalise(t);
}

export function clock(time?: Partial<TimeT> | null): string {
  const t = normalise(time);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(t.minute / MINUTES_PER_HOUR))}:${pad(t.minute % MINUTES_PER_HOUR)}`;
}

export function stamp(time?: Partial<TimeT> | null): string {
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

export function longStamp(time?: Partial<TimeT> | null): string {
  const t = normalise(time);
  return `${weekday(t)}, ${date(t)}, ${t.era}E${t.year}, ${clock(t)}`;
}

export function partOfDay(time?: Partial<TimeT> | null): string {
  const hour = Math.floor(normalise(time).minute / MINUTES_PER_HOUR);
  if (hour < 5) return "the small hours";
  if (hour < 8) return "early morning";
  if (hour < 12) return "morning";
  if (hour < 14) return "midday";
  if (hour < 18) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}
