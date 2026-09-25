import type { DatabaseSync } from "node:sqlite";
import { EXPLORERS, RING_SLOTS } from "../config.ts";
import { fields, flag, list, named, once, whole } from "./shared.ts";

export default function holdings(con: DatabaseSync, id: string, value: unknown) {
  if (Object.values(EXPLORERS).includes(id)) throw new Error(`what ${id} carries is the adventurer's and is not written by hand`);
  const rows = once(
    list(value, "holdings").map((raw, n) => {
      const what = `holding ${n + 1}`;
      const got = fields(raw, what, ["item", "qty", "worn"]);
      const item = named(con, got.item, what, "items");
      if (!item) throw new Error(`${what} has to name an item`);
      const qty = got.qty === undefined ? 1 : whole(got.qty, `the count of ${item}`);
      if (qty === null || qty < 1) throw new Error(`the count of ${item} has to be at least 1`);
      const worn = flag(got.worn, `${item}: worn`);
      const slot = (con.prepare("SELECT slot FROM item WHERE id = ?").get(item) as { slot?: string | null } | undefined)?.slot ?? null;
      if (worn && !slot) throw new Error(`${item} has no slot, so it cannot be worn`);
      return { item, qty, worn, slot };
    }),
    (r) => r.item,
    (r) => `${r.item} is there twice`
  );
  const on = new Map<string, string>();
  for (const r of rows) {
    if (!r.worn || !r.slot || r.slot === "ring") continue;
    const other = on.get(r.slot);
    if (other) throw new Error(`${other} and ${r.item} are both worn as ${r.slot}`);
    on.set(r.slot, r.item);
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
