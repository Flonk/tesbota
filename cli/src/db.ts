/**
 * The world is a SQLite file. This lays out the shape of a new one and hands out
 * the three ways anybody reads it: `rows`, `row`, `value`. A table already on
 * disk keeps the shape it has; changing one takes a migration written for it.
 *
 * `node:sqlite` is synchronous, which suits a driver that does one thing at a
 * time and makes a transaction a plain try/finally rather than a promise chain.
 */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CANON_DB, KINDS, PLACE_TYPE_NAMES, SLOTS } from "./config.ts";

const listed = (values: readonly string[]) => values.map((v) => `'${v}'`).join(",");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS entity (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN (${listed(KINDS)})),
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
  type   TEXT CHECK (type IN (${listed(PLACE_TYPE_NAMES)})),
  lat    REAL,
  lon    REAL,
  width  REAL
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
  slot       TEXT CHECK (slot IN (${listed(SLOTS)}))
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

/**
 * Lay the shape down. Safe to run every time: a table that is already there is
 * left as it is, less any column dropped here, and the views, triggers and index
 * are made again from it.
 */
export function setup(): string {
  fs.mkdirSync(path.dirname(CANON_DB), { recursive: true });
  const db = connect();
  try {
    db.exec("PRAGMA journal_mode = WAL");
  } finally {
    db.close();
  }
  writing((con) => {
    for (const r of con.prepare("SELECT type, name FROM sqlite_master WHERE type IN ('view', 'trigger')").all() as Row[]) {
      con.exec(`DROP ${r.type === "view" ? "VIEW" : "TRIGGER"} IF EXISTS "${r.name}"`);
    }
    con.exec(SCHEMA);
    if (con.prepare("SELECT 1 FROM pragma_table_info('orbit') WHERE name = 'around'").get()) {
      con.exec("ALTER TABLE orbit DROP COLUMN around");
    }
    reindex(con);
  });
  return CANON_DB;
}

/** The search index, made again from everything written. */
export function reindex(con: DatabaseSync) {
  con.exec("DELETE FROM search");
  con.exec("INSERT INTO search(ref, entity, section, body) SELECT ref, entity, section, body FROM writing");
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
