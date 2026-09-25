import type { DatabaseSync } from "node:sqlite";
import { BODY } from "../canon.ts";
import { band, fields, said, upsert, whole } from "./shared.ts";

const ZERO = ["bonus", "defense"];

export function fightStats(value: unknown): Record<string, string | number | null> {
  const got = fields(value, "body", BODY);
  const row: Record<string, string | number | null> = {};
  for (const [key, raw] of Object.entries(got)) {
    if (key === "damage") row.damage = band(raw, "damage");
    else if (key === "skill") row.skill = said(raw);
    else {
      const n = whole(raw, key) ?? (ZERO.includes(key) ? 0 : null);
      if (n !== null && n <= 0 && (key === "health" || key === "dc")) throw new Error(`${key} has to be more than 0`);
      if (n !== null && n < 0 && key === "defense") throw new Error("defense cannot be less than 0");
      row[key] = n;
    }
  }
  return row;
}

export default function body(con: DatabaseSync, id: string, value: unknown) {
  if (value === null) {
    con.prepare("DELETE FROM body WHERE id = ?").run(id);
    return;
  }
  upsert(con, "body", id, fightStats(value));
}
