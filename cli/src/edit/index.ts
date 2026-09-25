import type { DatabaseSync } from "node:sqlite";
import * as db from "../db.ts";
import { canonWrong } from "../check.ts";
import type { KINDS } from "../config.ts";
import entity from "./entity.ts";
import person from "./person.ts";
import body from "./body.ts";
import place from "./place.ts";
import ways from "./ways.ts";
import orbit from "./orbit.ts";
import item from "./item.ts";
import effects from "./effects.ts";
import book, { narrated } from "./book.ts";
import passages from "./passages.ts";
import aspect from "./aspect.ts";
import { granted, grants } from "./grants.ts";
import ability from "./ability.ts";
import tags from "./tags.ts";
import holdings from "./holdings.ts";

type Section = (con: DatabaseSync, id: string, value: unknown, all: Record<string, unknown>) => void;

const SECTIONS: Record<string, { apply: Section; kinds?: readonly (typeof KINDS)[number][] }> = {
  entity: { apply: entity },
  person: { apply: person, kinds: ["people"] },
  body: { apply: body },
  place: { apply: place, kinds: ["places"] },
  ways: { apply: ways, kinds: ["places"] },
  orbit: { apply: orbit, kinds: ["places"] },
  item: { apply: item, kinds: ["items"] },
  effects: { apply: effects, kinds: ["items"] },
  book: { apply: book, kinds: ["books"] },
  passages: { apply: passages, kinds: ["books"] },
  aspect: { apply: aspect, kinds: ["aspects"] },
  grants: { apply: grants, kinds: ["aspects"] },
  ability: { apply: ability, kinds: ["abilities"] },
  granted: { apply: granted, kinds: ["abilities"] },
  tags: { apply: tags },
  holdings: { apply: holdings, kinds: ["people", "places"] },
};

/** Change one thing in the record: every section of the patch, or none of it. */
export function edit(id: string, patch: unknown) {
  const ident = String(id || "").trim().toLowerCase();
  if (!ident) return { error: "nothing named" };
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return { error: "a patch is an object of sections" };
  const there = db.row("SELECT kind FROM entity WHERE id = ?", [ident]);
  if (!there) return { error: `nothing in the world is called ${ident}` };
  if (there.kind === "books" && narrated(db.value("SELECT author FROM book WHERE id = ?", [ident]))) {
    return { error: "the chronicle is the record of what happened and is never edited" };
  }
  const sections = patch as Record<string, unknown>;
  const unknown = Object.keys(sections).filter((key) => !Object.hasOwn(SECTIONS, key));
  if (unknown.length) return { error: `no such section: ${unknown.join(", ")}` };
  const kind = String(there.kind);
  for (const key of Object.keys(sections)) {
    const kinds: readonly string[] | undefined = SECTIONS[key].kinds;
    if (kinds && !kinds.includes(kind)) return { error: `${key}: ${ident} is one of the ${kind}, not the ${kinds.join(" or ")}` };
  }
  try {
    db.writing((con) => {
      for (const [key, value] of Object.entries(sections)) SECTIONS[key].apply(con, ident, value, sections);
      con.prepare("UPDATE entity SET changed = datetime('now') WHERE id = ?").run(ident);
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  let wrong: string[] = [];
  try {
    wrong = canonWrong()
      .filter((w) => w.ids?.includes(ident) || (w.what === "calendar" && "orbit" in sections))
      .map((w) => w.said);
  } catch {}
  return { ok: true, id: ident, wrong };
}
