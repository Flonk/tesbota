/**
 * The library, and every way of reading or adding to it.
 *
 * Nothing here knows about turns, agents or dice — it is the world's record and
 * the hands that write it, and that is all.
 */

import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import * as db from "./db.ts";
import { random, type Rng } from "./rng.ts";
import {
  EXPLORERS, FORBIDDEN_AUTHORS, GODHEADS, KINDS, NARRATOR, TRAITS, TRAITS_ROLLED, WEIGHT,
} from "./config.ts";

const LETTERS: Record<string, string> = { ß: "ss", æ: "ae", œ: "oe", ø: "o", ł: "l", đ: "d", ð: "d", þ: "th" };

export const slug = (text: unknown): string =>
  String(text ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f'’]/g, "")
    .toLowerCase()
    .replace(/[ßæœøłđðþ]/g, (letter) => LETTERS[letter] ?? "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const SMALL = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into",
  "nor", "of", "on", "onto", "or", "over", "the", "to", "up", "upon", "with",
]);

/**
 * A thing is named the way a title is set: every word but the small joining ones
 * in the middle, and a word that already capitalises itself is left alone.
 */
function titled(name: unknown): string {
  const words = String(name ?? "").split(/\s+/).filter(Boolean);
  return words
    .map((word, at) => {
      if (word.slice(1) !== word.slice(1).toLowerCase()) return word;
      if (at && at < words.length - 1 && SMALL.has(word.toLowerCase().replace(/[,.:;]+$/g, "")))
        return word.toLowerCase();
      return word.slice(0, 1).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

export const findEntity = (id: string) =>
  db.row("SELECT * FROM entity WHERE id = ?", [slug(id)]);

type Minted = Exclude<(typeof KINDS)[number], "books">;

const TABLE: Record<Minted, string> = {
  people: "person", places: "place", items: "item", aspects: "aspect", abilities: "ability",
};

function mint(
  con: DatabaseSync, kind: Minted, entityId: string, name?: string | null, turnId?: string | null
): string {
  const ident = slug(entityId);
  let called = name || ident.replace(/-/g, " ");
  if (["items", "aspects", "abilities"].includes(kind)) called = titled(called);
  con.prepare("INSERT OR IGNORE INTO entity (id, kind, name, introduced) VALUES (?,?,?,?)")
    .run(ident, kind, called, turnId ?? null);
  con.prepare(`INSERT OR IGNORE INTO ${TABLE[kind]} (id) SELECT id FROM entity WHERE id = ? AND kind = ?`)
    .run(ident, kind);
  return ident;
}

export const ensureEntity = (kind: Minted, entityId: string, name?: string | null, turnId?: string | null) =>
  db.writing((con) => mint(con, kind, entityId, name, turnId));

export const passages = (bookId: string) =>
  db.rows("SELECT * FROM passage WHERE book_id = ? ORDER BY ord", [slug(bookId)]);

/** A place's own row — what contains it and what sort of place it is. */
export const findPlace = (placeId: string | null | undefined) =>
  db.row("SELECT * FROM place WHERE id = ?", [slug(placeId)]);

const contains = (placeId: string): string[] =>
  db.rows("SELECT id FROM place WHERE parent = ? ORDER BY id", [slug(placeId)]).map((r) => String(r.id));

export function library() {
  return db.rows(
    `SELECT e.id, e.name, b.author, b.author_id, b.written, b.rarity
       FROM book b JOIN entity e ON e.id = b.id
      ORDER BY lower(e.name)`
  ).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    author: r.author || "",
    author_id: r.author_id,
    written: r.written || "",
    rarity: String(r.rarity || "").toLowerCase(),
    godhead: GODHEADS.includes(String(r.author || "").trim().toLowerCase()),
    chronicle: String(r.author || "").trim() === NARRATOR,
  }));
}

/**
 * First names already spoken for, so a new life is not named after somebody who
 * is already in the world or after an explorer who has already lived.
 */
export function givenNames(): Set<string> {
  let people: db.Row[];
  let lives: db.Row[];
  try {
    people = db.rows("SELECT name FROM entity WHERE kind = 'people'");
    lives = db.rows("SELECT e.name FROM book b JOIN entity e ON e.id = b.id WHERE b.author = ?", [NARRATOR]);
  } catch {
    return new Set();
  }
  const taken = new Set(people.map((r) => String(r.name || "").split(" ")[0].toLowerCase()));
  for (const r of lives) {
    const rest = String(r.name || "").replace(/^The Life of /, "").split(" ");
    taken.add(rest[0].toLowerCase());
  }
  taken.delete("");
  return taken;
}

/** Three traits, drawn against their rarity. Nobody is picked twice. */
export function rollTraits(rng: Rng = random, howMany = TRAITS_ROLLED): string[] {
  let pool = [...TRAITS];
  const picked: string[] = [];
  while (pool.length && picked.length < howMany) {
    const weights = pool.map(([, rarity]) => WEIGHT[rarity] ?? 0.1);
    const [trait] = rng.weighted(pool, weights);
    picked.push(trait);
    pool = pool.filter(([t]) => t !== trait);
  }
  return picked;
}

/** What somebody is like. Rolled once, the first time anybody asks. */
export function traits(entityId: string, roll = false, rng: Rng = random): string[] {
  const ident = slug(entityId);
  const found = db.row("SELECT traits FROM person WHERE id = ?", [ident]);
  const written = String(found?.traits ?? "").trim();
  if (written) return written.split(",").map((t) => t.trim()).filter(Boolean);
  if (!roll) return [];
  const picked = rollTraits(rng);
  db.writing((con) => {
    con.prepare("INSERT OR IGNORE INTO person (id) VALUES (?)").run(ident);
    con.prepare("UPDATE person SET traits = ? WHERE id = ?").run(picked.join(", "), ident);
  });
  return picked;
}

const ARTICLE = /^(?:the|a|an)\s+/i;
const SPELLED = /\[([^\]]*)\]\(bota:\/\/[^)]*\)/g;
const QUOTED = /"[^"]*"|“[^”]*”/g;
const LINK = new RegExp(`bota://(${KINDS.join("|")})/([a-z0-9][a-z0-9-]*)(?:#([pc]\\d+))?`, "g");
const SHORTEST_NAME = 3;

const link = (kind: string, ident: string) => `bota://${kind}/${ident}`;

const mentioned = (text: string) => new Set([...text.matchAll(LINK)].map((m) => m[2]));

/**
 * What a link says, without where it points. The adventurer reads a terminal, not
 * the library.
 */
export const plain = (text: string | null | undefined) =>
  String(text ?? "").replace(SPELLED, "$1");

const escaped = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const namePattern = (form: string) =>
  new RegExp(`(?<!\\w)${form.split(/\s+/).map(escaped).join("\\s+")}(?!\\w)`, "gi");

type Form = [string, string, string, RegExp];

/**
 * Every string that names something, longest first, so a mill inside a village is
 * linked as the mill and not as the village.
 */
function candidates(): Form[] {
  const forms = new Map<string, [string, string, string]>();
  for (const r of db.rows("SELECT id, kind, name FROM entity")) {
    const name = String(r.name ?? "");
    for (const raw of [name, name.replace(ARTICLE, ""), String(r.id).replace(/-/g, " ")]) {
      const form = raw.split(/\s+/).filter(Boolean).join(" ");
      if (form.length < SHORTEST_NAME) continue;
      const key = form.toLowerCase();
      if (!forms.has(key)) forms.set(key, [form, String(r.kind), String(r.id)]);
    }
  }
  return [...forms.values()]
    .sort((a, b) => b[0].length - a[0].length)
    .map(([form, kind, ident]) => [form, kind, ident, namePattern(form)]);
}

/**
 * Turn the names of things the world already knows into addresses, once each,
 * leaving quotations and existing links exactly as they were.
 */
export function linkNames(text: string | null | undefined, forms?: Form[]): string {
  if (!text) return text as string;
  let out = String(text);
  const kept: Array<[number, number]> = [];
  for (const re of [SPELLED, QUOTED, LINK]) {
    for (const m of out.matchAll(re)) kept.push([m.index!, m.index! + m[0].length]);
  }
  const linked = mentioned(out);
  const edits: Array<[number, number, string]> = [];
  for (const [, kind, ident, pattern] of forms ?? candidates()) {
    if (linked.has(ident)) continue;
    for (const m of out.matchAll(pattern)) {
      const start = m.index!;
      const end = start + m[0].length;
      if (kept.some(([a, b]) => start < b && a < end)) continue;
      edits.push([start, end, `[${m[0]}](${link(kind, ident)})`]);
      kept.push([start, end]);
      linked.add(ident);
      break;
    }
  }
  for (const [start, end, address] of edits.sort((a, b) => b[0] - a[0])) {
    out = out.slice(0, start) + address + out.slice(end);
  }
  return out;
}

/**
 * Run every passage past the linker, so a name in a book is an address you can
 * follow back.
 */
export function linkWriting(): number {
  const forms = candidates();
  let touched = 0;
  db.writing((con) => {
    for (const r of con.prepare("SELECT book_id, ord, text FROM passage").all() as db.Row[]) {
      const linked = linkNames(String(r.text), forms);
      if (linked !== r.text) {
        con.prepare("UPDATE passage SET text = ? WHERE book_id = ? AND ord = ?")
          .run(linked, r.book_id, r.ord);
        touched += 1;
      }
    }
    for (const r of con.prepare("SELECT id, about FROM entity WHERE about IS NOT NULL").all() as db.Row[]) {
      const linked = linkNames(String(r.about), forms);
      if (linked !== r.about) {
        con.prepare("UPDATE entity SET about = ? WHERE id = ?").run(linked, r.id);
        touched += 1;
      }
    }
  });
  return touched;
}

export const illegalBooks = () =>
  db.rows("SELECT id, lower(trim(author)) a FROM book")
    .filter((r) => FORBIDDEN_AUTHORS.includes(String(r.a)))
    .map((r) => String(r.id));

function graph() {
  const nodes: Record<string, { name: string }> = {};
  const edges: Array<[string, string]> = [];
  const links: Array<[string, string]> = [];
  for (const r of db.rows("SELECT id, name FROM entity WHERE kind = 'places' ORDER BY id"))
    nodes[String(r.id)] = { name: String(r.name) };
  for (const r of db.rows("SELECT id, parent FROM place WHERE parent IS NOT NULL ORDER BY id"))
    links.push([String(r.parent), String(r.id)]);
  for (const r of db.rows("SELECT src, dst FROM way ORDER BY src, dst"))
    edges.push([String(r.src), String(r.dst)]);
  return { nodes, edges, links };
}

export function mermaid(): string {
  const { nodes, edges, links } = graph();
  if (!Object.keys(nodes).length) return "graph LR\n  empty[the world has no places yet]";

  const children: Record<string, string[]> = {};
  const parentOf: Record<string, string> = {};
  for (const [parent, child] of links) {
    if (nodes[parent] && nodes[child] && parent !== child) {
      (children[parent] ||= []).push(child);
      parentOf[child] = parent;
    }
  }

  const out = ["graph LR"];
  const emit = (ident: string, depth: number, seen: Set<string>) => {
    const pad = "  ".repeat(depth + 1);
    const label = nodes[ident].name;
    const kids = (children[ident] || []).slice().sort();
    if (!kids.length) {
      out.push(`${pad}${ident}[${label}]`);
      return;
    }
    out.push(`${pad}subgraph ${ident}[${label}]`);
    for (const kid of kids) {
      if (seen.has(kid)) continue;
      emit(kid, depth + 1, new Set([...seen, kid]));
    }
    out.push(`${pad}end`);
  };

  for (const root of Object.keys(nodes).sort().filter((i) => !parentOf[i])) {
    emit(root, 0, new Set([root]));
  }
  for (const [src, dst] of edges) if (nodes[dst]) out.push(`  ${src} --> ${dst}`);
  return out.join("\n");
}

/**
 * Everything anybody carries is a thing the world has a row for. Naming one that
 * has none writes it down, the same as naming a place.
 */
const thing = (name: string, turnId?: string | null): string | null =>
  slug(name) ? ensureEntity("items", name, name, turnId) : null;

const STATS = ["type", "weight", "worth", "owed_by", "rarity", "slot"];

/**
 * What a thing is, written on the thing itself. A kind of thing the world has not
 * met yet gets a row here before anybody is handed one.
 */
export function describe(
  name: string, effectsOf?: Record<string, string> | null, stats: Record<string, unknown> = {}
): string | null {
  if (!slug(name)) return null;
  const known = Object.entries(stats).filter(([k, v]) => STATS.includes(k) && v != null);
  return db.writing((con) => {
    const item = mint(con, "items", name, name);
    if (known.length) {
      const sets = known.map(([k]) => `${k} = ?`).join(", ");
      con.prepare(`UPDATE item SET ${sets} WHERE id = ?`).run(...known.map(([, v]) => v as SQLInputValue), item);
    }
    for (const [stat, amount] of Object.entries(effectsOf || {})) affect(con, item, stat, amount);
    return item;
  });
}

/**
 * What a thing does is a row for each stat it moves, so a ring worth +1 dex costs
 * the world no column.
 */
function affect(con: DatabaseSync, item: string, stat: string, amount: unknown) {
  con.prepare(
    "INSERT INTO effect (item, stat, amount) VALUES (?, ?, ?) " +
      "ON CONFLICT (item, stat) DO UPDATE SET amount = excluded.amount"
  ).run(item, stat, String(amount));
}

type Effect = { stat: string; amount: string };

/** What each of these things does, by id. */
function effects(items: string[]): Record<string, Effect[]> {
  const ids = items.map(slug).filter(Boolean);
  if (!ids.length) return {};
  const marks = ids.map(() => "?").join(",");
  const out: Record<string, Effect[]> = {};
  for (const r of db.rows(
    `SELECT item, stat, amount FROM effect WHERE item IN (${marks}) ORDER BY id`, ids
  )) {
    (out[String(r.item)] ||= []).push({ stat: String(r.stat), amount: String(r.amount) });
  }
  return out;
}

/**
 * What a thing does, said in a line. Each amount carries its own sign, so a stat
 * nobody has thought of yet reads the same as damage does.
 */
export function does(from: Record<string, unknown> | Effect[] | null | undefined): string {
  const pairs: Array<[string, unknown]> = Array.isArray(from)
    ? from.map((e) => [e.stat, e.amount])
    : Object.entries(from || {});
  return pairs.map(([stat, amount]) => `${amount} ${stat}`).join(", ");
}

export type Holding = {
  item: string; name: string; type: string | null; slot: string | null;
  rarity: string | null; about: string; weight: number | null;
  effects: Effect[]; qty: number; worn: boolean;
};

export function holdings(holder: string): Holding[] {
  const found = db.rows(
    `SELECT h.item, h.qty, h.worn, e.name, e.about, i.type, i.weight, i.slot, i.rarity
       FROM holding h
       LEFT JOIN entity e ON e.id = h.item
       LEFT JOIN item i ON i.id = h.item
      WHERE h.holder = ? ORDER BY h.id`,
    [holder]
  );
  const powers = effects(found.map((r) => String(r.item)));
  return found.map((r) => ({
    item: String(r.item),
    name: String(r.name || String(r.item).replace(/-/g, " ")),
    type: r.type ?? null,
    slot: r.slot ?? null,
    rarity: r.rarity ?? null,
    about: String(r.about || ""),
    weight: r.weight ?? null,
    effects: powers[String(r.item)] || [],
    qty: Number(r.qty),
    worn: !!r.worn,
  }));
}

export const ABILITY = [
  "damage", "advantage", "cooldown", "sleep", "delay", "spawn", "within", "in_kind", "in_aspect",
] as const;

export const BODY = ["health", "damage", "dc", "bonus", "defense", "skill"] as const;

/** What the record calls a thing, or nothing if it has no row. */
export const called = (entityId: string): string | null =>
  db.value<string>("SELECT name FROM entity WHERE id = ?", [slug(entityId)]);

type BodyRow = Record<(typeof BODY)[number], any>;

/** The fight stats a thing carries, or nothing if it has never been given any. */
export function body(entityId: string): BodyRow | null {
  const found = db.row("SELECT * FROM body WHERE id = ?", [slug(entityId)]);
  if (!found) return null;
  return Object.fromEntries(BODY.map((k) => [k, found[k]])) as BodyRow;
}

type AbilityRow = Record<string, any>;

function readAbility(r: db.Row | null): AbilityRow | null {
  if (!r) return null;
  const out: AbilityRow = Object.fromEntries(ABILITY.map((k) => [k, r[k]]));
  out.id = r.id;
  out.name = r.name || String(r.id).replace(/-/g, " ");
  out.advantage = !!out.advantage;
  out.spawn = out.spawn ? JSON.parse(String(out.spawn)) : null;
  return out;
}

/** Everything an aspect hands out. */
export const abilitiesOf = (aspectId: string) =>
  db.rows(
    `SELECT a.*, e.name FROM grants g
       JOIN ability a ON a.id = g.ability
       LEFT JOIN entity e ON e.id = g.ability
      WHERE g.aspect = ? ORDER BY g.id`,
    [slug(aspectId)]
  ).map(readAbility).filter(Boolean) as AbilityRow[];

/** Everything a thing is marked with, and what each mark is of. */
export const aspectsOf = (entityId: string) =>
  db.rows(
    `SELECT t.aspect, t.value, e.name,
            (SELECT ve.name FROM entity ve WHERE ve.id = t.value) AS of_name
       FROM tagged t
       LEFT JOIN entity e ON e.id = t.aspect
      WHERE t.entity = ? ORDER BY t.id`,
    [slug(entityId)]
  ).map((r) => ({
    aspect: String(r.aspect),
    name: String(r.name || String(r.aspect).replace(/-/g, " ")),
    value: r.value ?? null,
    of: r.of_name ?? null,
  }));

/**
 * Whether a thing carries an aspect — used to ask of a place whether it is the
 * sort of place something counts in.
 */
export const markedWith = (entityId: string, aspectId: string) =>
  !!db.row("SELECT 1 FROM tagged WHERE entity = ? AND aspect = ?", [slug(entityId), slug(aspectId)]);

/**
 * Everyone with something to their name. The explorer is one of them and is not
 * an entity, because the one moving through this world is never a subject of the
 * library.
 */
export function holders() {
  const walkers = new Set(Object.values(EXPLORERS));
  return db.rows("SELECT DISTINCT holder FROM holding ORDER BY holder").map((r) => {
    const id = String(r.holder);
    const walker = walkers.has(id);
    const entity = walker ? null : findEntity(id);
    return {
      id,
      name: entity ? String(entity.name) : id.replace(/-/g, " "),
      kind: entity ? String(entity.kind) : null,
      explorer: walker,
    };
  });
}

/** A negative row is a debt somebody has written and is good for. */
function shift(
  con: DatabaseSync, holder: string, item: string, delta: number, worn = false, turnId: string | null = null
): number {
  const found = con.prepare("SELECT id, qty FROM holding WHERE holder = ? AND item = ?")
    .get(holder, item) as db.Row | undefined;
  const left = (found ? Number(found.qty) : 0) + delta;
  if (found && left === 0) con.prepare("DELETE FROM holding WHERE id = ?").run(found.id);
  else if (found) con.prepare("UPDATE holding SET qty = ? WHERE id = ?").run(left, found.id);
  else if (left !== 0) {
    con.prepare("INSERT INTO holding (holder, item, qty, worn, turn_id) VALUES (?,?,?,?,?)")
      .run(holder, item, left, worn ? 1 : 0, turnId);
  }
  return left;
}

export function give(holder: string, name: string, qty = 1, worn = false, turnId?: string | null): number {
  const item = thing(name, turnId);
  if (!holder || !item) return 0;
  const want = Math.trunc(qty || 1);
  db.writing((con) => shift(con, holder, item, want, worn, turnId ?? null));
  return want;
}

/** Everything a holder had, gone from them. Used when a life ends. */
export const strip = (holder: string) =>
  db.writing((con) => con.prepare("DELETE FROM holding WHERE holder = ?").run(holder).changes);

/**
 * Move a thing between two holders. Either side may be nothing — bread is eaten,
 * wood is cut. A holder may hand over what they do not have, going short by it,
 * which is how a promise is written down; nothing can be owed to the world.
 */
export function transfer(
  src: string | null, dst: string | null, name: string, qty = 1, turnId?: string | null
): number {
  const item = dst ? thing(name, turnId) : slug(name);
  if (!item) return 0;
  const want = Math.trunc(qty || 1);
  return db.writing((con) => {
    const found = src
      ? con.prepare("SELECT qty, worn FROM holding WHERE holder = ? AND item = ?").get(src, item) as db.Row | undefined
      : undefined;
    const moved = src && !dst ? (found ? Math.min(want, Math.max(0, Number(found.qty))) : 0) : want;
    if (!moved) return 0;
    if (src) shift(con, src, item, -moved);
    if (dst) shift(con, dst, item, moved, !!found?.worn, turnId ?? null);
    return moved;
  });
}

/**
 * What everything at a place is holding — the place's own stock and whatever
 * stands in it.
 */
export function holdingsAt(placeId: string | null | undefined) {
  const ident = slug(placeId);
  if (!ident) return [];
  const out = [];
  for (const holder of [ident, ...contains(ident)]) {
    const items = holdings(holder);
    if (!items.length) continue;
    const entity = findEntity(holder);
    out.push({
      id: holder,
      name: entity ? String(entity.name) : holder.replace(/-/g, " "),
      items,
    });
  }
  return out;
}
