import type { DatabaseSync } from "node:sqlite";
import { fields, said } from "./shared.ts";

export default function entity(con: DatabaseSync, id: string, value: unknown) {
  const got = fields(value, "entity", ["name", "about"]);
  if ("name" in got) {
    const name = said(got.name);
    if (!name) throw new Error("a thing has to be called something");
    con.prepare("UPDATE entity SET name = ? WHERE id = ?").run(name, id);
  }
  if ("about" in got) con.prepare("UPDATE entity SET about = ? WHERE id = ?").run(said(got.about), id);
}
