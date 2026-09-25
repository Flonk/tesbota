/** What every section needs to say no properly. */

import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { BAND } from "../schema.ts";

const KINDS: Record<string, string> = {
  people: "people", person: "people",
  places: "places", place: "places",
  books: "books", book: "books",
  items: "items", item: "items",
  aspects: "aspects", aspect: "aspects",
  abilities: "abilities", ability: "abilities",
};

/** Addresses written by hand, put the way the record writes them: `bota://aspect/Mob` is `bota://aspects/mob`. */
export const addresses = (text: string) =>
  text.replace(/bota:\/\/([A-Za-z]+)\/([A-Za-z0-9][A-Za-z0-9-]*)/g, (whole, kind, id) => {
    const known = KINDS[kind.toLowerCase()];
    return known ? `bota://${known}/${id.toLowerCase()}` : whole;
  });

/** An empty string is silence; `$BOTA` and everything else is kept as written. */
export const said = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = addresses(String(value).trim());
  return text === "" ? null : text;
};

/** A number, or silence. Anything else is refused. */
export function number(value: unknown, what: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${what} has to be a number`);
  return n;
}

/** A whole number, or silence. */
export function whole(value: unknown, what: string): number | null {
  const n = number(value, what);
  if (n !== null && !Number.isInteger(n)) throw new Error(`${what} has to be a whole number`);
  return n;
}

const YES: unknown[] = [true, 1, "1", "true", "yes"];
const NO: unknown[] = [false, 0, "0", "false", "no"];

export function flag(value: unknown, what: string): 0 | 1 {
  if (YES.includes(value)) return 1;
  if (NO.includes(value) || said(value) === null) return 0;
  throw new Error(`${what} is yes or no`);
}

export function band(value: unknown, what: string): string | null {
  const text = said(value);
  if (text !== null && BAND.exec(text)?.[0] !== text) throw new Error(`${what} reads like 2-5, or one number`);
  return text;
}

/** An entity that exists, and of the right kind when one is asked for. */
export function named(
  con: DatabaseSync, value: unknown, what: string, kind: string | string[] | null = null, owed = false
): string | null {
  const id = said(value)?.toLowerCase() ?? null;
  if (id === null) return null;
  if (id === "$bota") {
    if (!owed) throw new Error(`${what}: $BOTA names nothing yet`);
    return "$BOTA";
  }
  const row = con.prepare("SELECT kind FROM entity WHERE id = ?").get(id) as { kind?: string } | undefined;
  if (!row) throw new Error(`${what}: nothing in the world is called ${id}`);
  const kinds = kind === null ? null : Array.isArray(kind) ? kind : [kind];
  if (kinds && !kinds.includes(String(row.kind))) {
    throw new Error(`${what}: ${id} is one of the ${row.kind}, not the ${kinds.join(" or ")}`);
  }
  return id;
}

/** One of a fixed list, or silence. */
export function oneOf(value: unknown, what: string, allowed: readonly string[]): string | null {
  const text = said(value);
  if (text === null) return null;
  if (!allowed.includes(text)) throw new Error(`${what} is one of ${allowed.join(", ")}`);
  return text;
}

/** Only the fields a section knows, so a typo is refused rather than ignored. */
export function fields(value: unknown, what: string, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${what} is an object of fields`);
  const extra = Object.keys(value).filter((k) => !allowed.includes(k));
  if (extra.length) throw new Error(`${what} has no ${extra.join(", ")}`);
  return value as Record<string, unknown>;
}

/** A list, or refused. */
export function list(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${what} is a list`);
  return value;
}

export function once<T>(rows: T[], keyOf: (row: T) => string, twice: (row: T) => string): T[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = keyOf(row);
    if (seen.has(key)) throw new Error(twice(row));
    seen.add(key);
  }
  return rows;
}

export function upsert(con: DatabaseSync, table: string, id: string, row: Record<string, SQLInputValue>) {
  const keys = Object.keys(row);
  const columns = ["id", ...keys];
  const then = keys.length ? `DO UPDATE SET ${keys.map((k) => `${k} = excluded.${k}`).join(", ")}` : "DO NOTHING";
  con
    .prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")}) ON CONFLICT(id) ${then}`)
    .run(id, ...keys.map((k) => row[k]));
}
