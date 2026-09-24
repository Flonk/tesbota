import type { Ctx } from "./index.ts";
import { list, named } from "./shared.ts";

export default function granted(con: any, id: string, value: unknown, ctx: Ctx) {
  if (ctx.kind !== "abilities") throw new Error(`granted: ${id} is one of the ${ctx.kind}, not the abilities`);
  const seen = new Set<string>();
  const aspects = list(value, "granted").map((v) => {
    const aspect = named(con, v, "granted by", "aspects");
    if (!aspect || aspect === "$BOTA") throw new Error("granted by: every row names an aspect");
    if (seen.has(aspect)) throw new Error(`granted by: ${aspect} is named twice`);
    seen.add(aspect);
    return aspect;
  });
  con.prepare("INSERT INTO ability (id) VALUES (?) ON CONFLICT(id) DO NOTHING").run(id);
  con.prepare("DELETE FROM grants WHERE ability = ?").run(id);
  for (const aspect of aspects) con.prepare("INSERT INTO grants (aspect, ability) VALUES (?, ?)").run(aspect, id);
}
