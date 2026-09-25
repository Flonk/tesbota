/**
 * Give a thing a new id, and take every mention of the old one with it: the rows
 * that point at it, the links written into prose, the index, and the saved games
 * that remember where somebody stood.
 */

import fs from "node:fs";
import path from "node:path";
import * as db from "./db.ts";
import { ROOT } from "./config.ts";
import { Id } from "./schema.ts";

const POINTERS: Array<[string, string]> = [
  ["place", "id"], ["place", "parent"],
  ["person", "id"], ["person", "lives"],
  ["book", "id"], ["book", "author_id"],
  ["passage", "book_id"],
  ["orbit", "id"],
  ["way", "src"], ["way", "dst"],
  ["item", "id"], ["effect", "item"],
  ["aspect", "id"], ["ability", "id"], ["ability", "within"], ["ability", "in_aspect"],
  ["body", "id"],
  ["grants", "aspect"], ["grants", "ability"],
  ["tagged", "entity"], ["tagged", "aspect"], ["tagged", "value"],
  ["holding", "holder"], ["holding", "item"],
];

const LINKED = "LIKE '%bota://%/' || ? || '%'";

const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every link to the id in a piece of text, and nothing else: prose that happens to use the word is left alone. */
const relink = (from: string, to: string) => {
  const address = new RegExp(`(bota://[a-z]+/)${escaped(from)}(?![a-z0-9-])`, "g");
  return (text: string) => text.replace(address, `$1${to}`);
};

function files(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return files(full);
    return e.name.endsWith(".json") ? [full] : [];
  });
}

export function rename(from: string, to: string, name: string | null = null) {
  const old = String(from || "").trim().toLowerCase();
  const next = String(to || "").trim().toLowerCase();
  if (!Id.safeParse(next).success) return { error: `${to} is not an id: lowercase words joined by hyphens` };
  const was = db.row("SELECT kind FROM entity WHERE id = ?", [old]);
  if (!was) return { error: `nothing in the world is called ${old}` };
  if (old !== next && db.row("SELECT 1 FROM entity WHERE id = ?", [next])) return { error: `${next} is already taken` };
  const change = relink(old, next);

  try {
    db.writing((con) => {
      con.exec("PRAGMA defer_foreign_keys = ON");
      if (old !== next) {
        con.prepare("UPDATE entity SET id = ? WHERE id = ?").run(next, old);
        for (const [table, column] of POINTERS) {
          con.prepare(`UPDATE "${table}" SET "${column}" = ? WHERE "${column}" = ?`).run(next, old);
        }
        const abouts = con.prepare(`SELECT id, about FROM entity WHERE about ${LINKED}`).all(old) as db.Row[];
        const putAbout = con.prepare("UPDATE entity SET about = ? WHERE id = ?");
        for (const r of abouts) putAbout.run(change(String(r.about)), r.id);
        const texts = con.prepare(`SELECT book_id, ord, text FROM passage WHERE text ${LINKED}`).all(old) as db.Row[];
        const putText = con.prepare("UPDATE passage SET text = ? WHERE book_id = ? AND ord = ?");
        for (const r of texts) putText.run(change(String(r.text)), r.book_id, r.ord);
      }
      if (name && name.trim()) con.prepare("UPDATE entity SET name = ? WHERE id = ?").run(name.trim(), next);
      db.reindex(con);
      const broken = con.prepare("PRAGMA foreign_key_check").all();
      if (broken.length) throw new Error(`renaming would leave ${broken.length} rows pointing at nothing`);
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  const touched: string[] = [];
  if (old !== next) {
    const walk = (v: unknown): unknown =>
      typeof v === "string" ? (v === old ? next : change(v))
      : Array.isArray(v) ? v.map(walk)
      : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
      : v;
    for (const file of files(path.join(ROOT, "state"))) {
      const text = fs.readFileSync(file, "utf8");
      if (!text.includes(old)) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        continue;
      }
      const walked = walk(parsed);
      if (JSON.stringify(walked) === JSON.stringify(parsed)) continue;
      fs.writeFileSync(file, JSON.stringify(walked, null, 2) + (text.endsWith("\n") ? "\n" : ""));
      touched.push(path.relative(ROOT, file));
    }
  }
  return { ok: true, from: old, to: next, name: name?.trim() || null, files: touched };
}
