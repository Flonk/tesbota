import type { Ctx } from "./index.ts";
import { addresses, fields, said } from "./shared.ts";

export default function entity(con: any, id: string, value: unknown, _ctx: Ctx) {
  const got = fields(value, "entity", ["name", "about"]);
  if ("name" in got) {
    const name = said(got.name);
    if (!name) throw new Error("a thing has to be called something");
    con.prepare("UPDATE entity SET name = ? WHERE id = ?").run(name, id);
  }
  if ("about" in got) {
    const about = typeof got.about === "string" ? addresses(got.about.trim()) : null;
    con.prepare("UPDATE entity SET about = ? WHERE id = ?").run(about || null, id);
  }
}
