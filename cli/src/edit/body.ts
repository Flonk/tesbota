import type { Ctx } from "./index.ts";
import { fields, said, whole } from "./shared.ts";

const WHOLE = { health: "health", dc: "dc", bonus: "bonus", defense: "defense" } as const;
const ZERO = ["bonus", "defense"];

export default function body(con: any, id: string, value: unknown, _ctx: Ctx) {
  if (value === null) {
    con.prepare("DELETE FROM body WHERE id = ?").run(id);
    return;
  }
  const got = fields(value, "body", ["health", "damage", "dc", "bonus", "defense", "skill"]);
  con.prepare("INSERT INTO body (id) VALUES (?) ON CONFLICT(id) DO NOTHING").run(id);
  for (const [key, raw] of Object.entries(got)) {
    let v: string | number | null;
    if (key in WHOLE) {
      v = whole(raw, WHOLE[key as keyof typeof WHOLE]);
      if (v === null && ZERO.includes(key)) v = 0;
    } else v = said(raw);
    con.prepare(`UPDATE body SET ${key} = ? WHERE id = ?`).run(v, id);
  }
}
