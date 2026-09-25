/**
 * The library, and every way of reading or adding to it.
 *
 * Nothing here knows about turns, agents or dice — it is the world's record and
 * the hands that write it, and that is all.
 */

import * as db from "./db.ts";
import { random, type Rng } from "./rng.ts";
import {
  EXPLORERS, FORBIDDEN_AUTHORS, GODHEADS, KINDS, NARRATOR, TRAITS, TRAITS_ROLLED, WEIGHT,
} from "./config.ts";

export const ATTESTED = "attested";

export const slug = (text: unknown): string =>
  String(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ'’]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
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
export function titled(name: unknown): string {
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

export function ensureEntity(
  kind: string, entityId: string, name?: string | null, turnId?: string | null, author?: string | null
): string {
  const ident = slug(entityId);
  const sort = (KINDS as readonly string[]).includes(kind) ? kind : "places";
  let called = name || ident.replace(/-/g, " ");
  if (["items", "books", "aspects", "abilities"].includes(sort)) called = titled(called);
  db.writing((con) => {
    con.prepare("INSERT OR IGNORE INTO entity (id, kind, name, introduced) VALUES (?,?,?,?)")
      .run(ident, sort, called, turnId ?? null);
    if (sort === "people") con.prepare("INSERT OR IGNORE INTO person (id) VALUES (?)").run(ident);
    if (sort === "books") {
      const by = author || "unknown";
      const byId =
        (con.prepare("SELECT id FROM entity WHERE id = ? AND kind = 'people'").get(slug(by)) as db.Row)
          ?.id ?? null;
      con.prepare("INSERT OR IGNORE INTO book (id, author, author_id) VALUES (?,?,?)")
        .run(ident, by, byId);
    }
  });
  return ident;
}

export const passages = (bookId: string) =>
  db.rows("SELECT * FROM passage WHERE book_id = ? ORDER BY ord", [slug(bookId)]);

export const passage = (bookId: string, ord: number) =>
  db.row("SELECT * FROM passage WHERE book_id = ? AND ord = ?", [slug(bookId), ord]);

/** A place's own row — what contains it and what sort of place it is. */
export const findPlace = (placeId: string | null | undefined) =>
  db.row("SELECT * FROM place WHERE id = ?", [slug(placeId)]);

export const contains = (placeId: string): string[] =>
  db.rows("SELECT id FROM place WHERE parent = ? ORDER BY id", [slug(placeId)]).map((r) => String(r.id));

export function ancestry(placeId: string): Array<{ id: string; name: string }> {
  const found = db.rows(
    `WITH RECURSIVE up(id, depth) AS (
       SELECT ?, 0
       UNION
       SELECT p.parent, up.depth + 1 FROM place p JOIN up ON p.id = up.id
        WHERE up.depth < 24 AND p.parent IS NOT NULL
     )
     SELECT up.id, coalesce(entity.name, replace(up.id, '-', ' ')) AS name, up.depth
       FROM up LEFT JOIN entity ON entity.id = up.id
      ORDER BY up.depth DESC`,
    [slug(placeId)]
  );
  return found.filter((r) => r.id).map((r) => ({ id: String(r.id), name: String(r.name) }));
}

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

export const person = (entityId: string) =>
  db.row(
    `SELECT p.id, p.work, p.lives, p.born, p.died, p.traits,
            coalesce(l.name, replace(p.lives, '-', ' ')) AS lives_name
       FROM person p LEFT JOIN entity l ON l.id = p.lives
      WHERE p.id = ?`,
    [slug(entityId)]
  );

const ARTICLE = /^(?:the|a|an)\s+/i;
const ANCHORED = /\[[^\]]*\]\(bota:\/\/[^)]*\)/g;
const SPELLED = /\[([^\]]*)\]\(bota:\/\/[^)]*\)/g;
const QUOTED = /"[^"]*"|“[^”]*”/g;
const SHORTEST_NAME = 3;

/**
 * What a link says, without where it points. The adventurer reads a terminal, not
 * the library.
 */
export const plain = (text: string | null | undefined) =>
  String(text ?? "").replace(SPELLED, "$1");

/**
 * Every string that names something, longest first, so a mill inside a village is
 * linked as the mill and not as the village.
 */
export function candidates(): Array<[string, string, string]> {
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
  return [...forms.values()].sort((a, b) => b[0].length - a[0].length);
}

const escaped = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const namePattern = (form: string) =>
  new RegExp(`(?<!\\w)${form.split(/\s+/).map(escaped).join("\\s+")}(?!\\w)`, "gi");

/**
 * Turn the names of things the world already knows into addresses, once each,
 * leaving quotations and existing links exactly as they were.
 */
export function linkNames(text: string | null | undefined): string {
  if (!text) return text as string;
  let out = String(text);
  const kept: Array<[number, number]> = [];
  for (const re of [ANCHORED, QUOTED, new RegExp(db.LINK.source, "g")]) {
    for (const m of out.matchAll(re)) kept.push([m.index!, m.index! + m[0].length]);
  }
  const linked = new Set(db.mentioned(out));
  const edits: Array<[number, number, string]> = [];
  for (const [form, kind, ident] of candidates()) {
    if (linked.has(ident)) continue;
    for (const m of out.matchAll(namePattern(form))) {
      const start = m.index!;
      const end = start + m[0].length;
      if (kept.some(([a, b]) => start < b && a < end)) continue;
      edits.push([start, end, `[${m[0]}](${db.link(kind, ident)})`]);
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
  let touched = 0;
  db.writing((con) => {
    for (const r of con.prepare("SELECT book_id, ord, text FROM passage").all() as db.Row[]) {
      const linked = linkNames(String(r.text));
      if (linked !== r.text) {
        con.prepare("UPDATE passage SET text = ? WHERE book_id = ? AND ord = ?")
          .run(linked, r.book_id, r.ord);
        touched += 1;
      }
    }
    for (const r of con.prepare("SELECT id, about FROM entity WHERE about IS NOT NULL").all() as db.Row[]) {
      const linked = linkNames(String(r.about));
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

export function graph() {
  const nodes: Record<string, { name: string }> = {};
  const edges: Array<[string, string, string, string]> = [];
  const links: Array<[string, string]> = [];
  for (const r of db.rows("SELECT id, name FROM entity WHERE kind = 'places' ORDER BY id"))
    nodes[String(r.id)] = { name: String(r.name) };
  for (const r of db.rows("SELECT id, parent FROM place WHERE parent IS NOT NULL ORDER BY id"))
    links.push([String(r.parent), String(r.id)]);
  for (const r of db.rows("SELECT src, dst, bearing, distance FROM way ORDER BY src, dst"))
    edges.push([String(r.src), String(r.dst), String(r.bearing || ""), String(r.distance || "")]);
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
  for (const [src, dst, bearing, distance] of edges) {
    if (!nodes[dst]) continue;
    const label = [bearing, distance].filter(Boolean).join(" ");
    out.push(`  ${src} ${label ? `-- ${label} -->` : "-->"} ${dst}`);
  }
  return out.join("\n");
}

/**
 * Everything anybody carries is a thing the world has a row for. Naming one that
 * has none writes it down, the same as naming a place.
 */
export function thing(name: string, kind = "items", turnId?: string | null): string | null {
  const ident = slug(name);
  if (!ident) return null;
  if (!findEntity(ident)) {
    db.writing((con) => {
      con.prepare("INSERT OR IGNORE INTO entity (id, kind, name, introduced) VALUES (?,?,?,?)")
        .run(ident, kind, titled(name), turnId ?? null);
      con.prepare("INSERT OR IGNORE INTO item (id) VALUES (?)").run(ident);
    });
  }
  return ident;
}

const STATS = ["type", "weight", "worth", "owed_by", "rarity", "slot"];

/**
 * What a thing is, written on the thing itself. A kind of thing the world has not
 * met yet gets a row here before anybody is handed one.
 */
export function describe(
  name: string, effectsOf?: Record<string, string> | null, stats: Record<string, unknown> = {}
): string | null {
  const item = thing(name);
  if (!item) return null;
  const known = Object.entries(stats).filter(([k, v]) => STATS.includes(k) && v != null);
  if (known.length) {
    db.writing((con) => {
      const sets = known.map(([k]) => `${k} = ?`).join(", ");
      con.prepare(`UPDATE item SET ${sets} WHERE id = ?`).run(...known.map(([, v]) => v as any), item);
    });
  }
  for (const [stat, amount] of Object.entries(effectsOf || {})) affect(item, stat, amount);
  return item;
}

/**
 * What a thing does is a row for each stat it moves, so a ring worth +1 dex costs
 * the world no column.
 */
export function affect(item: string, stat: string, amount: unknown) {
  db.writing((con) => {
    con.prepare(
      "INSERT INTO effect (item, stat, amount) VALUES (?, ?, ?) " +
        "ON CONFLICT (item, stat) DO UPDATE SET amount = excluded.amount"
    ).run(slug(item), stat, String(amount));
  });
}

export type Effect = { stat: string; amount: string };

/** What each of these things does, by id. */
export function effects(items: string[]): Record<string, Effect[]> {
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

export const held = (holder: string, name: string) =>
  db.row("SELECT * FROM holding WHERE holder = ? AND item = ?", [holder, slug(name)]);

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

/**
 * An aspect is a thing in its own right — citizen, sworn, cursed — that other
 * things can be marked with. What it grants is written on the aspect, not on
 * everybody wearing it.
 */
export function aspect(
  name: string, applies?: string | null, ability?: unknown, about?: string | null
): string {
  const ident = ensureEntity("aspects", slug(name), String(name));
  db.writing((con) => {
    con.prepare("INSERT OR IGNORE INTO aspect (id) VALUES (?)").run(ident);
    if (applies != null) con.prepare("UPDATE aspect SET applies = ? WHERE id = ?").run(applies, ident);
    if (ability !== undefined) {
      con.prepare("UPDATE aspect SET ability = ? WHERE id = ?")
        .run(ability ? JSON.stringify(ability) : null, ident);
    }
    if (about != null) con.prepare("UPDATE entity SET about = ? WHERE id = ?").run(about, ident);
  });
  return ident;
}

export const ABILITY = [
  "damage", "advantage", "cooldown", "sleep", "delay", "spawn", "within", "in_kind", "in_aspect",
] as const;

/**
 * What a body can do, written down once as a thing of its own. The columns are
 * what the driver rolls; the rest is in its description, for the game master.
 */
export function ability(name: string, about?: string | null, how: Record<string, unknown> = {}): string {
  const ident = ensureEntity("abilities", slug(name), String(name));
  const known: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(how)) {
    if (!(ABILITY as readonly string[]).includes(k) || v == null) continue;
    known[k] = k === "spawn" && typeof v !== "string" ? JSON.stringify(v)
      : k === "advantage" ? (v ? 1 : 0)
      : v;
  }
  db.writing((con) => {
    con.prepare("INSERT OR IGNORE INTO ability (id) VALUES (?)").run(ident);
    const keys = Object.keys(known);
    if (keys.length) {
      const sets = keys.map((k) => `${k} = ?`).join(", ");
      con.prepare(`UPDATE ability SET ${sets} WHERE id = ?`)
        .run(...keys.map((k) => known[k] as any), ident);
    }
    if (about != null) con.prepare("UPDATE entity SET about = ? WHERE id = ?").run(about, ident);
  });
  return ident;
}

export const BODY = ["health", "damage", "dc", "bonus", "defense", "skill"] as const;

/**
 * What a thing brings to a fight, written against the thing itself so it is the
 * same every time it is met.
 */
export function embody(entityId: string, stats: Record<string, unknown>): string {
  const ident = slug(entityId);
  const known = Object.entries(stats).filter(([k, v]) => (BODY as readonly string[]).includes(k) && v != null);
  db.writing((con) => {
    con.prepare("INSERT OR IGNORE INTO body (id) VALUES (?)").run(ident);
    if (known.length) {
      const sets = known.map(([k]) => `${k} = ?`).join(", ");
      con.prepare(`UPDATE body SET ${sets} WHERE id = ?`).run(...known.map(([, v]) => v as any), ident);
    }
  });
  return ident;
}

/** What the record calls a thing, or nothing if it has no row. */
export const called = (entityId: string): string | null =>
  db.value<string>("SELECT name FROM entity WHERE id = ?", [slug(entityId)]);

export type BodyRow = Record<(typeof BODY)[number], any>;

/** The fight stats a thing carries, or nothing if it has never been given any. */
export function body(entityId: string): BodyRow | null {
  const found = db.row("SELECT * FROM body WHERE id = ?", [slug(entityId)]);
  if (!found) return null;
  return Object.fromEntries(BODY.map((k) => [k, found[k]])) as BodyRow;
}

/** Every kind of body the world keeps for fighting, with what it brings. */
export const mobs = () =>
  db.rows(
    "SELECT e.id, e.name, e.about FROM entity e" +
      " JOIN tagged t ON t.entity = e.id AND t.aspect = 'mob' ORDER BY e.name"
  ).map((r) => ({
    id: String(r.id), name: String(r.name), about: r.about, body: body(String(r.id)),
  }));

/** An aspect hands out an ability to everything marked with it. */
export function grant(aspectId: string, abilityId: string) {
  db.writing((con) => {
    con.prepare("INSERT OR IGNORE INTO grants (aspect, ability) VALUES (?,?)")
      .run(slug(aspectId), slug(abilityId));
  });
  return true;
}

export type AbilityRow = Record<string, any>;

export function readAbility(r: db.Row | null): AbilityRow | null {
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

export const findAbility = (abilityId: string) =>
  readAbility(
    db.row(
      "SELECT a.*, e.name FROM ability a LEFT JOIN entity e ON e.id = a.id WHERE a.id = ?",
      [slug(abilityId)]
    )
  );

/**
 * Mark a thing with an aspect. `value` is what the aspect is of — the place a
 * citizen belongs to, the house somebody is sworn into.
 */
export function tag(entityId: string, aspectId: string, value?: unknown) {
  db.writing((con) => {
    con.prepare("INSERT OR IGNORE INTO tagged (entity, aspect, value) VALUES (?,?,?)")
      .run(slug(entityId), slug(aspectId), value ? String(value) : null);
  });
  return true;
}

export function untag(entityId: string, aspectId: string, value?: unknown) {
  db.writing((con) => {
    con.prepare(
      "DELETE FROM tagged WHERE entity = ? AND aspect = ? AND coalesce(value, '') = coalesce(?, '')"
    ).run(slug(entityId), slug(aspectId), value ? String(value) : null);
  });
  return true;
}

/** Everything a thing is marked with, and what each marking grants. */
export const aspectsOf = (entityId: string) =>
  db.rows(
    `SELECT t.aspect, t.value, e.name, a.applies, a.ability,
            (SELECT ve.name FROM entity ve WHERE ve.id = t.value) AS of_name
       FROM tagged t
       LEFT JOIN entity e ON e.id = t.aspect
       LEFT JOIN aspect a ON a.id = t.aspect
      WHERE t.entity = ? ORDER BY t.id`,
    [slug(entityId)]
  ).map((r) => ({
    aspect: String(r.aspect),
    name: String(r.name || String(r.aspect).replace(/-/g, " ")),
    value: r.value ?? null,
    of: r.of_name ?? null,
    applies: r.applies ?? null,
    ability: r.ability ? JSON.parse(String(r.ability)) : null,
  }));

/**
 * Whether a thing carries an aspect — used to ask of a place whether it is the
 * sort of place something counts in.
 */
export const markedWith = (entityId: string, aspectId: string) =>
  !!db.row("SELECT 1 FROM tagged WHERE entity = ? AND aspect = ?", [slug(entityId), slug(aspectId)]);

/** Everything marked with an aspect — every citizen of Alheim. */
export function bearingAspect(aspectId: string, value?: string | null) {
  let sql = "SELECT entity, value FROM tagged WHERE aspect = ?";
  const args: unknown[] = [slug(aspectId)];
  if (value) {
    sql += " AND value = ?";
    args.push(String(value));
  }
  return db.rows(sql + " ORDER BY entity", args);
}

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

export function give(holder: string, name: string, qty = 1, worn = false, turnId?: string | null): number {
  const item = thing(name, "items", turnId);
  if (!holder || !item) return 0;
  const want = Math.trunc(qty || 1);
  db.writing((con) => {
    const found = con.prepare("SELECT id, qty FROM holding WHERE holder = ? AND item = ?")
      .get(holder, item) as db.Row | undefined;
    if (found) {
      const left = Number(found.qty) + want;
      if (left === 0) con.prepare("DELETE FROM holding WHERE id = ?").run(found.id);
      else con.prepare("UPDATE holding SET qty = ? WHERE id = ?").run(left, found.id);
    } else {
      con.prepare("INSERT INTO holding (holder, item, qty, worn, turn_id) VALUES (?,?,?,?,?)")
        .run(holder, item, want, worn ? 1 : 0, turnId ?? null);
    }
  });
  return want;
}

/**
 * Give up what is asked for, or everything held if that is less. Taking what
 * nobody has is nothing happening.
 */
export function take(holder: string, name: string, qty = 1): number {
  const item = slug(name);
  if (!holder || !item) return 0;
  const want = Math.trunc(qty || 1);
  return db.writing((con) => {
    const found = con.prepare("SELECT id, qty FROM holding WHERE holder = ? AND item = ?")
      .get(holder, item) as db.Row | undefined;
    if (!found) return 0;
    const left = Number(found.qty) - want;
    if (left <= 0) {
      con.prepare("DELETE FROM holding WHERE id = ?").run(found.id);
      return Number(found.qty);
    }
    con.prepare("UPDATE holding SET qty = ? WHERE id = ?").run(left, found.id);
    return want;
  });
}

/** Everything a holder had, gone from them. Used when a life ends. */
export const strip = (holder: string) =>
  db.writing((con) => con.prepare("DELETE FROM holding WHERE holder = ?").run(holder).changes);

/**
 * Take from a holder past what they have, leaving them short by the rest. A
 * negative row is a debt somebody has written and is good for.
 */
export function owe(holder: string, name: string, qty = 1): number {
  const item = thing(name);
  if (!holder || !item) return 0;
  const want = Math.trunc(qty || 1);
  return db.writing((con) => {
    const found = con.prepare("SELECT id, qty FROM holding WHERE holder = ? AND item = ?")
      .get(holder, item) as db.Row | undefined;
    const left = (found ? Number(found.qty) : 0) - want;
    if (found && left === 0) con.prepare("DELETE FROM holding WHERE id = ?").run(found.id);
    else if (found) con.prepare("UPDATE holding SET qty = ? WHERE id = ?").run(left, found.id);
    else con.prepare("INSERT INTO holding (holder, item, qty) VALUES (?,?,?)").run(holder, item, left);
    return left;
  });
}

/**
 * Move a thing between two holders. Either side may be nothing — bread is eaten,
 * wood is cut. A holder may hand over what they do not have, going short by it,
 * which is how a promise is written down; nothing can be owed to the world.
 */
export function transfer(
  src: string | null, dst: string | null, name: string, qty = 1, turnId?: string | null
): number {
  let want = Math.trunc(qty || 1);
  let worn = false;
  if (src) {
    const found = held(src, name);
    if (found) worn = !!found.worn;
    if (dst) owe(src, name, want);
    else {
      want = take(src, name, want);
      if (!want) return 0;
    }
  }
  if (dst) give(dst, name, want, worn, turnId);
  return want;
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
