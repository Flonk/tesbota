import type { Ctx } from "./index.ts";
import { list, named } from "./shared.ts";

export default function grants(con: any, id: string, value: unknown, ctx: Ctx) {
  if (ctx.kind !== "aspects") throw new Error(`grants: ${id} is one of the ${ctx.kind}, not the aspects`);
  const seen = new Set<string>();
  const abilities = list(value, "grants").map((v) => {
    const ability = named(con, v, "grants", "abilities");
    if (!ability || ability === "$BOTA") throw new Error("grants: every row names an ability");
    if (seen.has(ability)) throw new Error(`grants: ${ability} is granted twice`);
    seen.add(ability);
    return ability;
  });
  con.prepare("DELETE FROM grants WHERE aspect = ?").run(id);
  for (const ability of abilities) {
    con.prepare("INSERT INTO ability (id) VALUES (?) ON CONFLICT(id) DO NOTHING").run(ability);
    con.prepare("INSERT INTO grants (aspect, ability) VALUES (?, ?)").run(id, ability);
  }
}
