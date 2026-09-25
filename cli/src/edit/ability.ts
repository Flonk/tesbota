import type { DatabaseSync } from "node:sqlite";
import { ABILITY } from "../canon.ts";
import { PLACE_TYPE_NAMES } from "../config.ts";
import { band, fields, flag, named, oneOf, said, upsert, whole } from "./shared.ts";

const SPAWN = ["name", "who", "count", "health", "most", "damage", "dc", "bonus", "defense", "skill"] as const;

const counted = (value: unknown, what: string): number => {
  const n = whole(value, what) ?? 0;
  if (n < 0) throw new Error(`${what} cannot be less than 0`);
  return n;
};

export function spawn(value: unknown): string | null {
  let got = value;
  if (typeof got === "string") {
    if (!got.trim()) return null;
    try {
      got = JSON.parse(got);
    } catch {
      throw new Error("spawn is written in json");
    }
  }
  if (got === null || got === undefined) return null;
  const fight = fields(got, "spawn", SPAWN);
  const out: Record<string, unknown> = {};
  for (const key of SPAWN) {
    if (!(key in fight)) continue;
    let v: unknown;
    if (key === "name" || key === "who" || key === "skill") v = said(fight[key]);
    else if (key === "damage") v = band(fight[key], "the damage of what it calls");
    else v = whole(fight[key], `the ${key} of what it calls`);
    if (v !== null) out[key] = v;
  }
  if (!out.name) throw new Error("spawn has to name what it calls");
  if ("count" in out && (out.count as number) < 1) throw new Error("spawn calls at least 1");
  for (const key of ["health", "most", "dc", "defense"]) {
    if (key in out && (out[key] as number) < 0) throw new Error(`the ${key} of what it calls cannot be less than 0`);
  }
  return JSON.stringify(out);
}

export default function ability(con: DatabaseSync, id: string, value: unknown) {
  const got = fields(value, "ability", ABILITY);
  const row: Record<string, string | number | null> = {};
  for (const key of ABILITY) {
    if (!(key in got)) continue;
    const v = got[key];
    if (key === "damage") row.damage = band(v, "damage");
    else if (key === "advantage") row.advantage = flag(v, "advantage");
    else if (key === "spawn") row.spawn = spawn(v);
    else if (key === "within") row.within = named(con, v, "within", "places");
    else if (key === "in_aspect") row.in_aspect = named(con, v, "in aspect", "aspects");
    else if (key === "in_kind") row.in_kind = oneOf(v, "in kind", PLACE_TYPE_NAMES);
    else row[key] = counted(v, key);
  }
  upsert(con, "ability", id, row);
}
