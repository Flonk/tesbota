import type { Ctx } from "./index.ts";
import { NARRATOR, RARITIES } from "../config.ts";
import { fields, named, oneOf, said } from "./shared.ts";

export const narrated = (author: unknown) => String(author ?? "").trim().toLowerCase() === NARRATOR.toLowerCase();

export default function book(con: any, id: string, value: unknown, ctx: Ctx) {
  if (ctx.kind !== "books") throw new Error(`${id} is one of the ${ctx.kind}, not a book`);
  const got = fields(value, "book", ["author", "author_id", "written", "rarity"]);
  const was = con.prepare("SELECT author, author_id, written, rarity FROM book WHERE id = ?").get(id) as
    | Record<string, string | null>
    | undefined;
  const next = { author: null, author_id: null, written: null, rarity: null, ...(was ?? {}) } as Record<string, string | null>;
  if ("author" in got) next.author = said(got.author);
  if ("author_id" in got) next.author_id = named(con, got.author_id, "author entry", "people");
  if ("written" in got) next.written = said(got.written);
  if ("rarity" in got) next.rarity = oneOf(said(got.rarity)?.toLowerCase(), "rarity", RARITIES);
  if (!next.author) throw new Error("a book has to have an author");
  if (next.author_id === "$BOTA") throw new Error("author entry: $BOTA is not a person");
  if (narrated(next.author)) throw new Error(`only the chronicle is written by ${NARRATOR}`);
  con
    .prepare(
      "INSERT INTO book (id, author, author_id, written, rarity) VALUES (?,?,?,?,?) " +
        "ON CONFLICT(id) DO UPDATE SET author = excluded.author, author_id = excluded.author_id, " +
        "written = excluded.written, rarity = excluded.rarity"
    )
    .run(id, next.author, next.author_id, next.written, next.rarity);
}
