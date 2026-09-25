import type { Ctx } from "./index.ts";
import { RARITIES, SLOTS } from "../config.ts";
import { fields, number, oneOf, said } from "./shared.ts";

const FIELDS = ["type", "slot", "rarity", "weight", "worth", "owed_by"] as const;

export default function item(con: any, id: string, value: unknown, ctx: Ctx) {
  if (ctx.kind !== "items") throw new Error(`item: ${id} is one of the ${ctx.kind}, not the items`);
  const got = fields(value, "item", FIELDS);
  con.prepare("INSERT INTO item (id) VALUES (?) ON CONFLICT(id) DO NOTHING").run(id);
  for (const key of FIELDS) {
    if (!(key in got)) continue;
    let v: string | number | null;
    if (key === "slot") v = oneOf(got.slot, "slot", SLOTS);
    else if (key === "rarity") v = oneOf(said(got.rarity)?.toLowerCase(), "rarity", RARITIES);
    else if (key === "weight") {
      v = number(got.weight, "weight");
      if (v !== null && v < 0) throw new Error("weight cannot be less than nothing");
    } else v = said(got[key]);
    con.prepare(`UPDATE item SET ${key} = ? WHERE id = ?`).run(v, id);
  }
}
