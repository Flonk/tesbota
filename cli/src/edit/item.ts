import type { DatabaseSync } from "node:sqlite";
import { RARITIES, SLOTS } from "../config.ts";
import { fields, number, oneOf, said, upsert } from "./shared.ts";

const FIELDS = ["type", "slot", "rarity", "weight", "worth", "owed_by"] as const;

export default function item(con: DatabaseSync, id: string, value: unknown) {
  const got = fields(value, "item", FIELDS);
  const row: Record<string, string | number | null> = {};
  for (const key of FIELDS) {
    if (!(key in got)) continue;
    if (key === "slot") row.slot = oneOf(got.slot, "slot", SLOTS);
    else if (key === "rarity") row.rarity = oneOf(said(got.rarity)?.toLowerCase(), "rarity", RARITIES);
    else if (key === "weight") {
      const weight = number(got.weight, "weight");
      if (weight !== null && weight < 0) throw new Error("weight cannot be less than nothing");
      row.weight = weight;
    } else row[key] = said(got[key]);
  }
  upsert(con, "item", id, row);
}
