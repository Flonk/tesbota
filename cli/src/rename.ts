/**
 * Give a thing a new id, and take every mention of the old one with it: the rows
 * that point at it, the links written into prose, the index, and the saved games
 * that remember where somebody stood.
 */

import fs from "node:fs";
import path from "node:path";
import * as db from "./db.ts";
import { ROOT } from "./config.ts";

const POINTERS: Array<[string, string]> = [
  ["place", "id"], ["place", "parent"],
  ["person", "id"], ["person", "lives"],
  ["book", "id"], ["book", "author_id"],
  ["passage", "book_id"],
  ["orbit", "id"], ["orbit", "around"],
  ["way", "src"], ["way", "dst"],
  ["item", "id"], ["effect", "item"],
  ["aspect", "id"], ["ability", "id"], ["ability", "within"], ["ability", "in_aspect"],
  ["body", "id"],
  ["grants", "aspect"], ["grants", "ability"],
  ["tagged", "entity"], ["tagged", "aspect"], ["tagged", "value"],
  ["holding", "holder"], ["holding", "item"],
];

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every whole mention of the id in a piece of text, and nothing that merely contains it. */
const swap = (from: string, to: string) => {
  const whole = new RegExp(`(?<![a-z0-9-])${escaped(from)}(?![a-z0-9-])`, "g");
  return (text: string) => text.replace(whole, to);
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
  if (!SLUG.test(next)) return { error: `${to} is not an id: lowercase words joined by hyphens` };
  const was = db.row("SELECT kind FROM entity WHERE id = ?", [old]);
  if (!was) return { error: `nothing in the world is called ${old}` };
  if (old !== next && db.row("SELECT 1 FROM entity WHERE id = ?", [next])) return { error: `${next} is already taken` };
  const change = swap(old, next);

  const conn = db.connect();
  try {
    conn.exec("PRAGMA foreign_keys = OFF");
    conn.exec("BEGIN");
    try {
      if (old !== next) {
        conn.prepare("UPDATE entity SET id = ? WHERE id = ?").run(next, old);
        for (const [table, column] of POINTERS) {
          try {
            conn.prepare(`UPDATE "${table}" SET "${column}" = ? WHERE "${column}" = ?`).run(next, old);
          } catch {}
        }
        const abouts = conn.prepare("SELECT id, about FROM entity WHERE about LIKE ?").all(`%${old}%`) as db.Row[];
        const putAbout = conn.prepare("UPDATE entity SET about = ? WHERE id = ?");
        for (const r of abouts) putAbout.run(change(String(r.about)), r.id);
        const texts = conn.prepare("SELECT book_id, ord, text FROM passage WHERE text LIKE ?").all(`%${old}%`) as db.Row[];
        const putText = conn.prepare("UPDATE passage SET text = ? WHERE book_id = ? AND ord = ?");
        for (const r of texts) putText.run(change(String(r.text)), r.book_id, r.ord);
      }
      if (name && name.trim()) conn.prepare("UPDATE entity SET name = ? WHERE id = ?").run(name.trim(), next);
      conn.exec("DELETE FROM search");
      conn.exec("INSERT INTO search(ref, entity, section, body) SELECT ref, entity, section, body FROM writing");
      const broken = conn.prepare("PRAGMA foreign_key_check").all();
      if (broken.length) throw new Error(`renaming would leave ${broken.length} rows pointing at nothing`);
      conn.exec("COMMIT");
    } catch (err) {
      conn.exec("ROLLBACK");
      throw err;
    }
  } finally {
    conn.exec("PRAGMA foreign_keys = ON");
    conn.close();
  }

  const touched: string[] = [];
  if (old !== next) {
    for (const file of files(path.join(ROOT, "state"))) {
      const text = fs.readFileSync(file, "utf8");
      if (!text.includes(old)) continue;
      const walk = (v: any): any =>
        typeof v === "string" ? change(v)
        : Array.isArray(v) ? v.map(walk)
        : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
        : v;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        continue;
      }
      fs.writeFileSync(file, JSON.stringify(walk(parsed), null, 2) + (text.endsWith("\n") ? "\n" : ""));
      touched.push(path.relative(ROOT, file));
    }
  }
  return { ok: true, from: old, to: next, name: name?.trim() || null, files: touched };
}
