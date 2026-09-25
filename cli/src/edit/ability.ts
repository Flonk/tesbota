import type { Ctx } from "./index.ts";
import { ABILITY } from "../canon.ts";
import { PLACE_TYPE_NAMES } from "../config.ts";
import { Band } from "../schema.ts";
import { fields, named, oneOf, said, whole } from "./shared.ts";

const SPAWN = ["name", "who", "count", "health", "most", "damage", "dc", "bonus", "defense", "skill"] as const;

const band = (value: unknown, what: string): string | null => {
  const text = said(value);
  if (text !== null && !Band.safeParse(text).success) throw new Error(`${what} reads like 2-5, or one number`);
  return text;
};

const counted = (value: unknown, what: string): number => {
  const n = whole(value, what) ?? 0;
  if (n < 0) throw new Error(`${what} cannot be less than 0`);
  return n;
};

function spawn(value: unknown): string | null {
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

export default function ability(con: any, id: string, value: unknown, ctx: Ctx) {
  if (ctx.kind !== "abilities") throw new Error(`ability: ${id} is one of the ${ctx.kind}, not the abilities`);
  const got = fields(value, "ability", ABILITY);
  con.prepare("INSERT INTO ability (id) VALUES (?) ON CONFLICT(id) DO NOTHING").run(id);
  for (const key of ABILITY) {
    if (!(key in got)) continue;
    const v = got[key];
    let out: string | number | null;
    if (key === "damage") out = band(v, "damage");
    else if (key === "advantage") {
      const on = v === true || v === 1 || v === "1" || v === "true" || v === "yes";
      const off = v === false || v === 0 || v === "0" || v === "false" || v === "no" || said(v) === null;
      if (!on && !off) throw new Error("advantage is yes or no");
      out = on ? 1 : 0;
    } else if (key === "spawn") out = spawn(v);
    else if (key === "within") out = named(con, v, "within", "places");
    else if (key === "in_aspect") out = named(con, v, "in aspect", "aspects");
    else if (key === "in_kind") out = oneOf(v, "in kind", PLACE_TYPE_NAMES);
    else out = counted(v, key);
    if (out === "$BOTA" && (key === "within" || key === "in_aspect")) throw new Error(`${key.replace("_", " ")} names a thing, not something owed`);
    con.prepare(`UPDATE ability SET ${key} = ? WHERE id = ?`).run(out, id);
  }
}
