import type { Ctx } from "./index.ts";
import { fields, list, named, said } from "./shared.ts";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export default function tags(con: any, id: string, value: unknown, _ctx: Ctx) {
  const rows = list(value, "tags").map((raw, n) => {
    const what = `aspect ${n + 1}`;
    const got = fields(raw, what, ["aspect", "value"]);
    const aspect = named(con, got.aspect, what, "aspects");
    if (!aspect || aspect === "$BOTA") throw new Error(`${what} has to name an aspect`);
    let of = said(got.value);
    if (of !== null && of !== "$BOTA") {
      const there = con.prepare("SELECT kind FROM entity WHERE id = ?").get(of.toLowerCase()) as { kind?: string } | undefined;
      if (there) of = of.toLowerCase();
      else if (SLUG.test(of)) throw new Error(`${what}: nothing in the world is called ${of}`);
      const applies = con.prepare("SELECT applies FROM aspect WHERE id = ?").get(aspect) as { applies?: string } | undefined;
      if (applies?.applies === "within" && there?.kind !== "places") {
        throw new Error(`${what}: ${aspect} counts within a place, so what it is of has to be one`);
      }
    }
    return { aspect, value: of };
  });
  const seen = new Set<string>();
  for (const r of rows) {
    const key = `${r.aspect}\u0000${r.value ?? ""}`;
    if (seen.has(key)) throw new Error(`${r.aspect}${r.value ? ` of ${r.value}` : ""} is there twice`);
    seen.add(key);
  }
  con.prepare("DELETE FROM tagged WHERE entity = ?").run(id);
  const put = con.prepare("INSERT INTO tagged (entity, aspect, value) VALUES (?, ?, ?)");
  for (const r of rows) put.run(id, r.aspect, r.value);
}
