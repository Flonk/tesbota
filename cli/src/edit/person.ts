import type { DatabaseSync } from "node:sqlite";
import { fields, named, said, upsert } from "./shared.ts";

const FIELDS = ["work", "lives", "born", "died", "traits"] as const;

export default function person(con: DatabaseSync, id: string, value: unknown) {
  const got = fields(value, "person", FIELDS);
  const row: Record<string, string | null> = {};
  for (const key of FIELDS) {
    if (!(key in got)) continue;
    if (key === "lives") row.lives = named(con, got.lives, "lives", "places", true);
    else if (key === "traits") {
      const words = Array.isArray(got.traits) ? got.traits : String(got.traits ?? "").split(",");
      row.traits = said(words.map((w) => String(w).trim()).filter(Boolean).join(", "));
    } else row[key] = said(got[key]);
  }
  upsert(con, "person", id, row);
}
