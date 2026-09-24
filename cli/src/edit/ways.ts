import type { Ctx } from "./index.ts";
import { fields, list, named, said } from "./shared.ts";

export default function ways(con: any, id: string, value: unknown, ctx: Ctx) {
  if (ctx.kind !== "places") throw new Error(`${id} is not a place, so no ways lead out of it`);
  const rows = list(value, "ways").map((raw, n) => {
    const got = fields(raw, `way ${n + 1}`, ["dst", "bearing", "distance"]);
    const dst = named(con, got.dst, `way ${n + 1}`, "places");
    if (!dst || dst === "$BOTA") throw new Error(`way ${n + 1} has to lead somewhere`);
    if (dst === id) throw new Error(`way ${n + 1} leads back to ${id} itself`);
    return { dst, bearing: said(got.bearing), distance: said(got.distance) };
  });
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.dst)) throw new Error(`two ways lead to ${r.dst}`);
    seen.add(r.dst);
  }
  con.prepare("DELETE FROM way WHERE src = ?").run(id);
  const put = con.prepare("INSERT INTO way (src, dst, bearing, distance) VALUES (?, ?, ?, ?)");
  for (const r of rows) put.run(id, r.dst, r.bearing, r.distance);
}
