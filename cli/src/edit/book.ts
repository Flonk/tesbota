import type { DatabaseSync } from "node:sqlite";
import { NARRATOR, RARITIES } from "../config.ts";
import { fields, named, oneOf, said, upsert } from "./shared.ts";

export const narrated = (author: unknown) => String(author ?? "").trim().toLowerCase() === NARRATOR.toLowerCase();

export default function book(con: DatabaseSync, id: string, value: unknown) {
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
  if (narrated(next.author)) throw new Error(`only the chronicle is written by ${NARRATOR}`);
  upsert(con, "book", id, next);
}
