/**
 * The world is a SQLite file. This lays out its shape, brings an older one up to
 * it, and hands out the three ways anybody reads it: `rows`, `row`, `value`.
 *
 * `node:sqlite` is synchronous, which suits a driver that does one thing at a
 * time and makes a transaction a plain try/finally rather than a promise chain.
 */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CANON_DB } from "./config.ts";

export const LINK = /bota:\/\/(people|places|books|items)\/([a-z0-9][a-z0-9-]*)(?:#([pc]\d+))?/g;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS entity (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('people','places','books','items','aspects','abilities')),
  name       TEXT NOT NULL,
  introduced TEXT,
  extent     TEXT,
  about      TEXT,
  made       TEXT,
  changed    TEXT
);

CREATE TABLE IF NOT EXISTS book (
  id      TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
  author    TEXT NOT NULL,
  author_id TEXT REFERENCES entity(id),
  written   TEXT,
  rarity    TEXT
);

CREATE TABLE IF NOT EXISTS person (
  id     TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
  lives  TEXT,
  work   TEXT,
  born   TEXT,
  died   TEXT,
  traits TEXT
);

CREATE TABLE IF NOT EXISTS passage (
  book_id TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  ord     INTEGER NOT NULL,
  text    TEXT NOT NULL,
  PRIMARY KEY (book_id, ord)
);

CREATE TABLE IF NOT EXISTS place (
  id     TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
  parent TEXT,
  type   TEXT CHECK (type IN ('location','region','river','celestial-body','celestial-system','realm')),
  lat    REAL,
  lon    REAL
);
CREATE INDEX IF NOT EXISTS place_parent ON place(parent);

-- What a body is, never what follows from it. There is no period here and no
-- day length: both are solved in sky.ts from the mass it goes round and the
-- distance it keeps, so no stored number can disagree with what made it.
--
-- A system's own row carries the mass at its middle and goes round nothing, so
-- a world can have a year before anybody has written down a sun.
CREATE TABLE IF NOT EXISTS orbit (
  id           TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
  around       TEXT REFERENCES entity(id),
  semi_major   REAL,
  eccentricity REAL NOT NULL DEFAULT 0,
  longitude    REAL NOT NULL DEFAULT 0,
  periapsis    REAL NOT NULL DEFAULT 0,
  mass         REAL,
  radius       REAL,
  oblateness   REAL NOT NULL DEFAULT 0,
  tilt         REAL NOT NULL DEFAULT 0,
  rotation     REAL,
  meridian     REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS way (
  src      TEXT NOT NULL,
  dst      TEXT NOT NULL,
  bearing  TEXT,
  distance TEXT,
  PRIMARY KEY (src, dst)
);
CREATE INDEX IF NOT EXISTS way_dst ON way(dst);

CREATE TABLE IF NOT EXISTS item (
  id         TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
  type       TEXT,
  weight     REAL,
  worth      TEXT,
  owed_by    TEXT,
  rarity     TEXT,
  slot       TEXT CHECK (slot IN ('helmet','chest','legs','feet','mainhand','offhand','ring'))
);

CREATE TABLE IF NOT EXISTS effect (
  id     INTEGER PRIMARY KEY,
  item   TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  stat   TEXT NOT NULL,
  amount TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS effect_once ON effect(item, stat);

CREATE TABLE IF NOT EXISTS aspect (
  id      TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
  applies TEXT CHECK (applies IN ('always','within')),
  ability TEXT
);

-- What a body can do, as a thing in its own right. The columns are what the driver
-- can roll on its own; the rest is in its about, for the game master to play.
CREATE TABLE IF NOT EXISTS ability (
  id        TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
  damage    TEXT,
  advantage INTEGER NOT NULL DEFAULT 0,
  cooldown  INTEGER NOT NULL DEFAULT 0,
  sleep     INTEGER NOT NULL DEFAULT 0,
  delay     INTEGER NOT NULL DEFAULT 0,
  spawn     TEXT,
  within    TEXT,
  in_kind   TEXT,
  in_aspect TEXT
);

-- What a body brings to a fight. Anything that can be fought carries one of these,
-- so a Rat is the same Rat every time it comes out of the grass. The game master may
-- write over any of it for one fight; what it writes never comes back here.
CREATE TABLE IF NOT EXISTS body (
  id      TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
  health  INTEGER,
  damage  TEXT,
  dc      INTEGER,
  bonus   INTEGER NOT NULL DEFAULT 0,
  defense INTEGER NOT NULL DEFAULT 0,
  skill   TEXT
);

CREATE TABLE IF NOT EXISTS grants (
  id      INTEGER PRIMARY KEY,
  aspect  TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  ability TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS grants_once ON grants(aspect, ability);

CREATE TABLE IF NOT EXISTS tagged (
  id     INTEGER PRIMARY KEY,
  entity TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  aspect TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  value  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS tagged_once ON tagged(entity, aspect, coalesce(value, ''));
CREATE INDEX IF NOT EXISTS tagged_aspect ON tagged(aspect);

CREATE TABLE IF NOT EXISTS holding (
  id       INTEGER PRIMARY KEY,
  holder   TEXT NOT NULL,
  item     TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  qty      INTEGER NOT NULL DEFAULT 1,
  worn     INTEGER NOT NULL DEFAULT 0,
  turn_id  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS holding_once ON holding(holder, item);
CREATE INDEX IF NOT EXISTS holding_holder ON holding(holder);

CREATE VIEW IF NOT EXISTS writing AS
  SELECT 'bota://books/' || p.book_id || '#p' || p.ord AS ref,
         p.book_id AS entity, 'books' AS kind, 'passage' AS section, p.text AS body
    FROM passage p
  UNION ALL
  SELECT 'bota://' || e.kind || '/' || e.id || '#about',
         e.id, e.kind, 'about', e.about
    FROM entity e WHERE e.about IS NOT NULL AND trim(e.about) <> '';

CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(
  ref UNINDEXED, entity UNINDEXED, section UNINDEXED, body
);

CREATE TRIGGER IF NOT EXISTS passage_ai AFTER INSERT ON passage BEGIN
  INSERT INTO search(ref, entity, section, body)
  VALUES ('bota://books/' || new.book_id || '#p' || new.ord, new.book_id, 'passage', new.text);
END;
CREATE TRIGGER IF NOT EXISTS passage_ad AFTER DELETE ON passage BEGIN
  DELETE FROM search WHERE ref = 'bota://books/' || old.book_id || '#p' || old.ord;
END;
CREATE TRIGGER IF NOT EXISTS passage_au AFTER UPDATE ON passage BEGIN
  DELETE FROM search WHERE ref = 'bota://books/' || old.book_id || '#p' || old.ord;
  INSERT INTO search(ref, entity, section, body)
  VALUES ('bota://books/' || new.book_id || '#p' || new.ord, new.book_id, 'passage', new.text);
END;

CREATE TRIGGER IF NOT EXISTS entity_made AFTER INSERT ON entity BEGIN
  UPDATE entity SET made = coalesce(new.made, datetime('now')),
                    changed = coalesce(new.changed, datetime('now'))
   WHERE id = new.id;
END;
CREATE TRIGGER IF NOT EXISTS entity_changed AFTER UPDATE ON entity
WHEN new.changed IS old.changed BEGIN
  UPDATE entity SET changed = datetime('now') WHERE id = new.id;
END;

CREATE TRIGGER IF NOT EXISTS entity_about_ai AFTER INSERT ON entity BEGIN
  INSERT INTO search(ref, entity, section, body)
  SELECT 'bota://' || new.kind || '/' || new.id || '#about', new.id, 'about', new.about
   WHERE new.about IS NOT NULL AND trim(new.about) <> '';
END;
CREATE TRIGGER IF NOT EXISTS entity_about_au AFTER UPDATE OF about ON entity BEGIN
  DELETE FROM search WHERE ref = 'bota://' || new.kind || '/' || new.id || '#about';
  INSERT INTO search(ref, entity, section, body)
  SELECT 'bota://' || new.kind || '/' || new.id || '#about', new.id, 'about', new.about
   WHERE new.about IS NOT NULL AND trim(new.about) <> '';
END;
CREATE TRIGGER IF NOT EXISTS entity_about_ad AFTER DELETE ON entity BEGIN
  DELETE FROM search WHERE ref = 'bota://' || old.kind || '/' || old.id || '#about';
END;
`;

export type Row = Record<string, any>;

export function connect(readonly = false): DatabaseSync {
  const db = new DatabaseSync(CANON_DB, readonly ? { readOnly: true } : {});
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

const RESORT_PLACE = `
CREATE TABLE place_sorted (
  id     TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
  parent TEXT,
  type   TEXT CHECK (type IN ('location','region','river','celestial-body','celestial-system','realm'))
);
INSERT INTO place_sorted (id, parent, type) SELECT id, parent, type FROM place;
DROP TABLE place;
ALTER TABLE place_sorted RENAME TO place;
CREATE INDEX IF NOT EXISTS place_parent ON place(parent);
`;

const WIDEN_KINDS = `
DROP VIEW IF EXISTS writing;
DROP VIEW IF EXISTS unwritten;
CREATE TABLE entity_kinds (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('people','places','books','items','aspects','abilities')),
  name       TEXT NOT NULL,
  introduced TEXT,
  extent     TEXT,
  about      TEXT,
  made       TEXT,
  changed    TEXT
);
INSERT INTO entity_kinds (id, kind, name, introduced, extent, about, made, changed)
  SELECT id, kind, name, introduced, extent, about, made, changed FROM entity;
DROP TABLE entity;
ALTER TABLE entity_kinds RENAME TO entity;
`;

const ANCHOR_ITEM = `
CREATE TABLE item_anchored (
  id         TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
  type       TEXT,
  weight     REAL,
  worth      TEXT,
  owed_by    TEXT,
  rarity     TEXT,
  slot       TEXT CHECK (slot IN ('helmet','chest','legs','feet','mainhand','offhand','ring'))
);
INSERT INTO item_anchored (id, type, weight, worth, owed_by, rarity, slot)
  SELECT id, type, weight, worth, owed_by, rarity, slot FROM item;
DROP TABLE item;
ALTER TABLE item_anchored RENAME TO item;
`;

const MOVED: ReadonlyArray<readonly [string, string, string]> = [
  ["damage", "damage", ""],
  ["protection", "defense", ""],
  ["heals", "health", "+"],
  ["sates", "hunger", "−"],
];

const columnsOf = (db: DatabaseSync, table: string) =>
  new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((r) => String(r.name)));

const sqlOf = (db: DatabaseSync, table: string) =>
  String(
    (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table) as Row)
      ?.sql ?? ""
  );

/** Lay the shape down, and carry an older file up to it. Safe to run every time. */
export function setup(): string {
  fs.mkdirSync(path.dirname(CANON_DB), { recursive: true });
  const db = connect();
  try {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec(
      "DROP VIEW IF EXISTS writing; DROP VIEW IF EXISTS unwritten;" +
        " DROP TRIGGER IF EXISTS entity_about_ai;"
    );
    db.exec(SCHEMA);

    const shape = columnsOf(db, "entity");
    if (!shape.has("extent")) db.exec("ALTER TABLE entity ADD COLUMN extent TEXT");
    if (!shape.has("about")) db.exec("ALTER TABLE entity ADD COLUMN about TEXT");
    for (const when of ["made", "changed"]) {
      if (!shape.has(when)) db.exec(`ALTER TABLE entity ADD COLUMN ${when} TEXT`);
    }
    db.exec(
      "UPDATE entity SET made = coalesce(made, datetime('now')), " +
        "changed = coalesce(changed, datetime('now')) " +
        "WHERE made IS NULL OR changed IS NULL"
    );

    const held = columnsOf(db, "person");
    for (const column of ["born", "died", "traits"]) {
      if (!held.has(column)) db.exec(`ALTER TABLE person ADD COLUMN ${column} TEXT`);
    }

    const placeSql = sqlOf(db, "place");
    if (!placeSql.includes("'river'") && placeSql.includes("type")) {
      db.exec("PRAGMA foreign_keys = OFF");
      db.exec(RESORT_PLACE);
      db.exec("PRAGMA foreign_keys = ON");
    }
    if (!columnsOf(db, "place").has("type")) {
      db.exec(
        "ALTER TABLE place ADD COLUMN type TEXT " +
          "CHECK (type IN ('location','region','river','celestial-body','celestial-system','realm'))"
      );
    }
    const stood = columnsOf(db, "place");
    for (const where of ["lat", "lon"]) {
      if (!stood.has(where)) db.exec(`ALTER TABLE place ADD COLUMN ${where} REAL`);
    }

    if (columnsOf(db, "holding").has("note")) db.exec("ALTER TABLE holding DROP COLUMN note");

    const carried = columnsOf(db, "item");
    if (!carried.has("rarity")) db.exec("ALTER TABLE item ADD COLUMN rarity TEXT");
    if (!carried.has("weight")) db.exec("ALTER TABLE item ADD COLUMN weight REAL");
    if (carried.has("uses")) db.exec("ALTER TABLE item DROP COLUMN uses");
    for (const [column, stat, sign] of MOVED) {
      if (!carried.has(column)) continue;
      db.prepare(
        "INSERT OR IGNORE INTO effect (item, stat, amount) " +
          `SELECT id, ?, ? || ${column} FROM item ` +
          `WHERE ${column} IS NOT NULL AND trim(${column}) <> ''`
      ).run(stat, sign);
      db.exec(`ALTER TABLE item DROP COLUMN ${column}`);
    }
    if (!carried.has("slot")) {
      db.exec(
        "ALTER TABLE item ADD COLUMN slot TEXT " +
          "CHECK (slot IN ('helmet','chest','legs','feet','mainhand','offhand','ring'))"
      );
    }

    // A description written at insert once missed the index entirely. This puts
    // back anything the index does not already hold, every time it is run.
    db.exec(`INSERT INTO search(ref, entity, section, body)
             SELECT 'bota://' || kind || '/' || id || '#about', id, 'about', about
               FROM entity
              WHERE trim(coalesce(about, '')) <> ''
                AND 'bota://' || kind || '/' || id || '#about' NOT IN
                    (SELECT ref FROM search)`);

    if (!sqlOf(db, "entity").includes("'abilities'")) {
      // Rebuilding entity takes its view and its triggers with it, so the schema
      // is laid down again afterwards to put them back.
      db.exec("PRAGMA foreign_keys = OFF");
      db.exec(WIDEN_KINDS);
      db.exec(SCHEMA);
      db.exec("PRAGMA foreign_keys = ON");
    }

    const borne = columnsOf(db, "ability");
    if (borne.size && !borne.has("in_aspect")) db.exec("ALTER TABLE ability ADD COLUMN in_aspect TEXT");
    if (borne.has("doing")) {
      // An ability had two descriptions: its own `about` like everything else, and
      // this. One thing, one description.
      db.exec(
        "UPDATE entity SET about = trim(coalesce(about, '') || ' ' || " +
          "coalesce((SELECT doing FROM ability WHERE ability.id = entity.id), '')) " +
          "WHERE id IN (SELECT id FROM ability WHERE trim(coalesce(doing, '')) <> '')"
      );
      db.exec("ALTER TABLE ability DROP COLUMN doing");
    }

    if (!sqlOf(db, "item").includes("REFERENCES entity")) {
      db.exec("DELETE FROM item WHERE id NOT IN (SELECT id FROM entity)");
      db.exec("PRAGMA foreign_keys = OFF");
      db.exec(ANCHOR_ITEM);
      db.exec("PRAGMA foreign_keys = ON");
    }
  } finally {
    db.close();
  }
  return CANON_DB;
}

/** A write, and the checkpoint after it, so a reader never sees half of one. */
export function writing<T>(fn: (db: DatabaseSync) => T): T {
  const db = connect();
  try {
    db.exec("BEGIN");
    let out: T;
    try {
      out = fn(db);
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    db.exec("COMMIT");
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    return out;
  } finally {
    db.close();
  }
}

export function rows(sql: string, args: unknown[] = []): Row[] {
  const db = connect(fs.existsSync(CANON_DB));
  try {
    return db.prepare(sql).all(...(args as any[])) as Row[];
  } finally {
    db.close();
  }
}

export function row(sql: string, args: unknown[] = []): Row | null {
  const found = rows(sql, args);
  return found.length ? found[0] : null;
}

export function value<T = any>(sql: string, args: unknown[] = [], fallback: T | null = null): T | null {
  const found = row(sql, args);
  if (!found) return fallback;
  const first = Object.values(found)[0];
  return (first === undefined ? fallback : first) as T;
}

export const link = (kind: string, ident: string, fragment?: string | null) =>
  `bota://${kind}/${ident}` + (fragment ? `#${fragment}` : "");

export function targets(text: string | null | undefined): Array<[string, string, string]> {
  const out: Array<[string, string, string]> = [];
  for (const m of String(text ?? "").matchAll(LINK)) out.push([m[1], m[2], m[3] || ""]);
  return out;
}

export const mentioned = (text: string | null | undefined) =>
  new Set(targets(text).map(([, ident]) => ident));
