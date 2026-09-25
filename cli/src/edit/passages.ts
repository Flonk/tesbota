import type { Ctx } from "./index.ts";
import { addresses, list } from "./shared.ts";

export default function passages(con: any, id: string, value: unknown, ctx: Ctx) {
  if (ctx.kind !== "books") throw new Error(`${id} is one of the ${ctx.kind}, not a book`);
  const texts = list(value, "passages").map((p, n) => {
    if (p !== null && typeof p !== "string") throw new Error(`passage ${n + 1} has to be text`);
    return p ?? "";
  });
  con.prepare("DELETE FROM passage WHERE book_id = ?").run(id);
  const put = con.prepare("INSERT INTO passage (book_id, ord, text) VALUES (?,?,?)");
  texts.filter((t) => t.trim() !== "").forEach((text, n) => put.run(id, n + 1, addresses(text)));
}
