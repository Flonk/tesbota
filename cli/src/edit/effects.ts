import type { Ctx } from "./index.ts";
import { fields, list, said } from "./shared.ts";

const WORDS = /^[a-z]+(?:[ -][a-z]+)*$/;

export default function effects(con: any, id: string, value: unknown, ctx: Ctx) {
  if (ctx.kind !== "items") throw new Error(`effects: ${id} is one of the ${ctx.kind}, not the items`);
  const rows = list(value, "effects").map((row, n) => {
    const got = fields(row, `effect ${n + 1}`, ["stat", "amount"]);
    const stat = said(got.stat)?.toLowerCase().replace(/\s+/g, " ") ?? null;
    if (!stat) throw new Error(`effect ${n + 1} has no stat`);
    if (!WORDS.test(stat)) throw new Error(`effect ${n + 1}: a stat is lowercase words, not ${stat}`);
    const amount = said(got.amount);
    if (!amount) throw new Error(`effect ${n + 1}: ${stat} has no amount`);
    return { stat, amount };
  });
  const seen = new Set<string>();
  for (const { stat } of rows) {
    if (seen.has(stat)) throw new Error(`effects name ${stat} twice`);
    seen.add(stat);
  }
  con.prepare("DELETE FROM effect WHERE item = ?").run(id);
  const put = con.prepare("INSERT INTO effect (item, stat, amount) VALUES (?, ?, ?)");
  for (const { stat, amount } of rows) put.run(id, stat, amount);
}
