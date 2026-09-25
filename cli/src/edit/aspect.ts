import type { DatabaseSync } from "node:sqlite";
import { fields, oneOf, upsert } from "./shared.ts";

export default function aspect(con: DatabaseSync, id: string, value: unknown) {
  const got = fields(value, "aspect", ["applies"]);
  const row: Record<string, string | null> = {};
  if ("applies" in got) row.applies = oneOf(got.applies, "applies", ["always", "within"]);
  upsert(con, "aspect", id, row);
}
