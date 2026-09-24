import type { Ctx } from "./index.ts";
import { fields, list, named } from "./shared.ts";

export default function ways(con: any, id: string, value: unknown, ctx: Ctx) {
  if (ctx.kind !== "places") throw new Error(`${id} is one of the ${ctx.kind}, not a place`);
  const seen = new Set<string>();
  const rows = list(value, "doors").map((row, n) => {
    const got = fields(row, `door ${n + 1}`, ["dst", "bearing", "distance"]);
    const dst = named(con, got.dst, `door ${n + 1}`, "places");
    if (!dst || dst === "$BOTA") throw new Error(`door ${n + 1} has to lead somewhere`);
    if (dst === id) throw new Error(`door ${n + 1} leads back into ${id}`);
    if (seen.has(dst)) throw new Error(`two doors lead into ${dst}`);
    seen.add(dst);
    return dst;
  });
  con.prepare("DELETE FROM way WHERE src = ?").run(id);
  const put = con.prepare("INSERT INTO way (src, dst) VALUES (?, ?)");
  for (const dst of rows) put.run(id, dst);
}
