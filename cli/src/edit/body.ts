import type { Ctx } from "./index.ts";
import { BODY } from "../canon.ts";
import { band, fields, said, whole } from "./shared.ts";

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

export default function body(con: any, id: string, value: unknown, _ctx: Ctx) {
  if (value === null) {
    con.prepare("DELETE FROM body WHERE id = ?").run(id);
    return;
  }
  const row = fightStats(value);
  con.prepare("INSERT INTO body (id) VALUES (?) ON CONFLICT(id) DO NOTHING").run(id);
  for (const [key, v] of Object.entries(row)) con.prepare(`UPDATE body SET ${key} = ? WHERE id = ?`).run(v, id);
}
