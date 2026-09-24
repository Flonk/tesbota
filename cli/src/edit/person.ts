import type { Ctx } from "./index.ts";
import { fields, named, said } from "./shared.ts";

const FIELDS = ["work", "lives", "born", "died", "traits"] as const;

export default function person(con: any, id: string, value: unknown, ctx: Ctx) {
  if (ctx.kind !== "people") throw new Error(`person: ${id} is one of the ${ctx.kind}, not the people`);
  const got = fields(value, "person", FIELDS);
  con.prepare("INSERT INTO person (id) VALUES (?) ON CONFLICT(id) DO NOTHING").run(id);
  for (const key of FIELDS) {
    if (!(key in got)) continue;
    let v: string | null;
    if (key === "lives") v = named(con, got.lives, "lives", "places");
    else if (key === "traits") {
      const words = Array.isArray(got.traits) ? got.traits : String(got.traits ?? "").split(",");
      v = said(words.map((w) => String(w).trim()).filter(Boolean).join(", "));
    } else v = said(got[key]);
    con.prepare(`UPDATE person SET ${key} = ? WHERE id = ?`).run(v, id);
  }
}
