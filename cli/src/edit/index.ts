import * as db from "../db.ts";
import { canonWrong } from "../check.ts";
import entity from "./entity.ts";
import person from "./person.ts";
import body from "./body.ts";
import place from "./place.ts";
import ways from "./ways.ts";
import orbit from "./orbit.ts";
import item from "./item.ts";
import effects from "./effects.ts";
import book from "./book.ts";
import passages from "./passages.ts";
import aspect from "./aspect.ts";
import grants from "./grants.ts";
import ability from "./ability.ts";
import granted from "./granted.ts";
import tags from "./tags.ts";
import holdings from "./holdings.ts";

export type Ctx = { kind: string; all: Record<string, unknown> };
export type Section = (con: any, id: string, value: any, ctx: Ctx) => void;

const SECTIONS: Record<string, Section> = {
  entity, person, body, place, ways, orbit, item, effects,
  book, passages, aspect, grants, ability, granted, tags, holdings,
};

/** Change one thing in the record: every section of the patch, or none of it. */
export function edit(id: string, patch: unknown) {
  const ident = String(id || "").trim().toLowerCase();
  if (!ident) return { error: "nothing named" };
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return { error: "a patch is an object of sections" };
  const there = db.row("SELECT kind FROM entity WHERE id = ?", [ident]);
  if (!there) return { error: `nothing in the world is called ${ident}` };
  const sections = patch as Record<string, unknown>;
  const unknown = Object.keys(sections).filter((key) => !SECTIONS[key]);
  if (unknown.length) return { error: `no such section: ${unknown.join(", ")}` };
  const ctx: Ctx = { kind: String(there.kind), all: sections };
  try {
    db.writing((con) => {
      for (const [key, value] of Object.entries(sections)) SECTIONS[key](con, ident, value, ctx);
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
