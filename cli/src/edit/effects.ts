import type { DatabaseSync } from "node:sqlite";
import { band, fields, list, once, said } from "./shared.ts";

const WORDS = /^[a-z]+(?:[ -][a-z]+)*$/;

export default function effects(con: DatabaseSync, id: string, value: unknown) {
  const rows = once(
    list(value, "effects").map((row, n) => {
      const got = fields(row, `effect ${n + 1}`, ["stat", "amount"]);
      const stat = said(got.stat)?.toLowerCase().replace(/\s+/g, " ") ?? null;
      if (!stat) throw new Error(`effect ${n + 1} has no stat`);
      if (!WORDS.test(stat)) throw new Error(`effect ${n + 1}: a stat is lowercase words, not ${stat}`);
      const amount = said(got.amount);
      if (!amount) throw new Error(`effect ${n + 1}: ${stat} has no amount`);
      if (stat === "damage") band(amount, `effect ${n + 1}: damage`);
      return { stat, amount };
    }),
    (r) => r.stat,
    (r) => `effects name ${r.stat} twice`
  );
  con.prepare("DELETE FROM effect WHERE item = ?").run(id);
  const put = con.prepare("INSERT INTO effect (item, stat, amount) VALUES (?, ?, ?)");
  for (const { stat, amount } of rows) put.run(id, stat, amount);
}
