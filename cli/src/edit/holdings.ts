import type { Ctx } from "./index.ts";
import { EXPLORERS, RING_SLOTS } from "../config.ts";
import { fields, list, named, whole } from "./shared.ts";

export default function holdings(con: any, id: string, value: unknown, ctx: Ctx) {
  if (ctx.kind !== "people" && ctx.kind !== "places") throw new Error(`${id} is not a person or a place, so it keeps nothing`);
  if (Object.values(EXPLORERS).includes(id)) throw new Error(`what ${id} carries is the adventurer's and is not written by hand`);
  const rows = list(value, "holdings").map((raw, n) => {
    const what = `holding ${n + 1}`;
    const got = fields(raw, what, ["item", "qty", "worn"]);
    const item = named(con, got.item, what, "items");
    if (!item || item === "$BOTA") throw new Error(`${what} has to name an item`);
    const qty = got.qty === undefined ? 1 : whole(got.qty, `the count of ${item}`);
    if (qty === null || qty < 1) throw new Error(`the count of ${item} has to be at least 1`);
    const w = got.worn;
    if (![undefined, null, "", 0, 1, "0", "1", true, false].includes(w as any)) throw new Error(`${item} is worn or not`);
    const worn = w === 1 || w === "1" || w === true ? 1 : 0;
    const slot = (con.prepare("SELECT slot FROM item WHERE id = ?").get(item) as { slot?: string | null } | undefined)?.slot ?? null;
    if (worn && !slot) throw new Error(`${item} has no slot, so it cannot be worn`);
    return { item, qty, worn, slot };
  });
  const seen = new Set<string>();
  const on = new Map<string, string>();
  for (const r of rows) {
    if (seen.has(r.item)) throw new Error(`${r.item} is there twice`);
    seen.add(r.item);
    if (!r.worn || r.slot === "ring") continue;
    const other = on.get(r.slot!);
    if (other) throw new Error(`${other} and ${r.item} are both worn as ${r.slot}`);
    on.set(r.slot!, r.item);
  }
  if (rows.filter((r) => r.worn && r.slot === "ring").length > RING_SLOTS) {
    throw new Error(`only ${RING_SLOTS} rings can be worn at once`);
  }
  const turns = new Map<string, string | null>(
    (con.prepare("SELECT item, turn_id FROM holding WHERE holder = ?").all(id) as { item: string; turn_id: string | null }[])
      .map((r) => [r.item, r.turn_id])
  );
  con.prepare("DELETE FROM holding WHERE holder = ?").run(id);
  const put = con.prepare("INSERT INTO holding (holder, item, qty, worn, turn_id) VALUES (?, ?, ?, ?, ?)");
  for (const r of rows) put.run(id, r.item, r.qty, r.worn, turns.get(r.item) ?? null);
}
