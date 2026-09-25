import type { Ctx } from "./index.ts";
import { fields, oneOf } from "./shared.ts";

export default function aspect(con: any, id: string, value: unknown, ctx: Ctx) {
  if (ctx.kind !== "aspects") throw new Error(`aspect: ${id} is one of the ${ctx.kind}, not the aspects`);
  const got = fields(value, "aspect", ["applies"]);
  con.prepare("INSERT INTO aspect (id) VALUES (?) ON CONFLICT(id) DO NOTHING").run(id);
  if ("applies" in got) {
    const applies = oneOf(got.applies, "applies", ["always", "within"]);
    con.prepare("UPDATE aspect SET applies = ? WHERE id = ?").run(applies, id);
  }
}
