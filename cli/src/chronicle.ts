/**
 * The narrator's book. Not an agent and not a prompt — the driver takes what the
 * game master actually said and sets it down, which is string work.
 *
 * It records that something happened and nothing more. It is unarguable about
 * events and is evidence for nothing about what the world is like; a lore master
 * that can find only this for a claim has found nothing.
 */

import * as canon from "./canon.ts";
import * as db from "./db.ts";
import { MYSTERY, NARRATOR, WORLD_START } from "./config.ts";
import { explorerName } from "./state.ts";
import type { TurnT } from "./schema.ts";

export const bookTitle = (name?: string | null) => `The Life of ${name || explorerName()}`;

export const bookId = (name?: string | null) => canon.slug(bookTitle(name));

export function ensureBook(turnId?: string | null): string {
  const { era, year } = WORLD_START;
  const book = bookId();
  const title = bookTitle();
  db.writing((con) => {
    con.prepare("INSERT OR IGNORE INTO entity (id, kind, name, introduced) VALUES (?,?,?,?)")
      .run(book, "books", title, turnId ?? null);
    con.prepare("INSERT OR IGNORE INTO book (id, author, author_id, written, rarity) VALUES (?,?,?,?,?)")
      .run(book, NARRATOR, null, `${era}E${year}`, "unique");
  });
  return book;
}

export const passages = () =>
  canon.passages(bookId()).map((r) => ({ ord: Number(r.ord), text: String(r.text) }));

export const nextOrd = () =>
  (db.value<number>("SELECT max(ord) FROM passage WHERE book_id = ?", [bookId()]) || 0) + 1;

export const since = (start: number) =>
  db.rows("SELECT ord, text FROM passage WHERE book_id = ? AND ord >= ? ORDER BY ord", [bookId(), start])
    .map((r) => ({ ord: Number(r.ord), text: String(r.text) }));

/**
 * One paragraph out of everything the game master said this turn, in order. The
 * explorer's own utterances are what prompted them, not the record.
 */
export function compose(turn: TurnT): string {
  let said = (turn.phases || [])
    .filter((p) => p.who === "gm" && String(p.text || "").trim())
    .map((p) => String(p.text || "").split(/\s+/).filter(Boolean).join(" "));
  if (!said.length) {
    const narration = String(turn.draft?.narration || "").split(/\s+/).filter(Boolean).join(" ");
    said = narration ? [narration] : [];
  }
  return said.join(" ");
}

export function write(turn: TurnT) {
  ensureBook(turn.turn_id);
  const text = compose(turn);
  if (!text) return [];
  const ord = nextOrd();
  db.writing((con) => {
    con.prepare("INSERT INTO passage (book_id, ord, text) VALUES (?,?,?)")
      .run(bookId(), ord, canon.linkNames(text));
  });
  return since(ord);
}

/**
 * The last passage of a life, in the same voice as the rest of the book. The
 * cause completes `who …`, so a life reads as one sentence at its end.
 */
export function close(cause?: string | null) {
  let said = String(cause || MYSTERY).split(/\s+/).filter(Boolean).join(" ").replace(/\.+$/, "");
  if (said.toLowerCase().startsWith("who ")) said = said.slice(4);
  const text = `Here ends the life of ${explorerName()}, who ${canon.linkNames(said)}.`;
  const ord = nextOrd();
  db.writing((con) => {
    con.prepare("INSERT INTO passage (book_id, ord, text) VALUES (?,?,?)").run(bookId(), ord, text);
  });
  return since(ord);
}

/** Take the book back to nothing, so it can be set down again in one voice. */
export const clear = () =>
  db.writing((con) => con.prepare("DELETE FROM passage WHERE book_id = ?").run(bookId()).changes);

export function played(turn: TurnT): boolean {
  if (turn.state === "arbiter" || turn.state === "lore3") return false;
  if ((turn.phases || []).length) {
    return turn.phases.some((p) => p.who === "gm" && String(p.text || "").trim());
  }
  return !!turn.draft?.narration;
}
