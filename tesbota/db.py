import re
import sqlite3
from contextlib import contextmanager

from .config import CANON_DB, KINDS

LINK = re.compile(r"bota://(people|places|books|items)/([a-z0-9][a-z0-9-]*)(?:#([pc]\d+))?")

SCHEMA = """
CREATE TABLE IF NOT EXISTS entity (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('people','places','books','items')),
  name       TEXT NOT NULL,
  introduced TEXT,
  extent     TEXT,
  about      TEXT
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
  parent TEXT
);
CREATE INDEX IF NOT EXISTS place_parent ON place(parent);

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

"""


def connect(readonly=False):
    if readonly:
        con = sqlite3.connect(f"file:{CANON_DB}?mode=ro", uri=True)
    else:
        con = sqlite3.connect(CANON_DB)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA busy_timeout = 5000")
    con.execute("PRAGMA foreign_keys = ON")
    return con


ANCHOR_ITEM = """
CREATE TABLE item_anchored (
  id         TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
  type       TEXT,
  worth      TEXT,
  owed_by    TEXT,
  rarity     TEXT,
  slot       TEXT CHECK (slot IN ('helmet','chest','legs','feet','mainhand','offhand','ring'))
);
INSERT INTO item_anchored (id, type, worth, owed_by, rarity, slot)
  SELECT id, type, worth, owed_by, rarity, slot FROM item;
DROP TABLE item;
ALTER TABLE item_anchored RENAME TO item;
"""

MOVED = (
    ("damage", "damage", ""),
    ("protection", "protection", ""),
    ("heals", "health", "+"),
    ("sates", "hunger", "−"),
)


def setup():
    CANON_DB.parent.mkdir(parents=True, exist_ok=True)
    con = connect()
    try:
        con.execute("PRAGMA journal_mode = WAL")
        con.executescript(
            "DROP VIEW IF EXISTS writing; DROP VIEW IF EXISTS unwritten;"
            " DROP TRIGGER IF EXISTS entity_about_ai;"
        )
        con.executescript(SCHEMA)
        shape = {r["name"] for r in con.execute("PRAGMA table_info(entity)")}
        if "extent" not in shape:
            con.execute("ALTER TABLE entity ADD COLUMN extent TEXT")
        if "about" not in shape:
            con.execute("ALTER TABLE entity ADD COLUMN about TEXT")
        held = {r["name"] for r in con.execute("PRAGMA table_info(person)")}
        for column in ("born", "died", "traits"):
            if column not in held:
                con.execute(f"ALTER TABLE person ADD COLUMN {column} TEXT")
        kept = {r["name"] for r in con.execute("PRAGMA table_info(holding)")}
        if "note" in kept:
            con.execute("ALTER TABLE holding DROP COLUMN note")
        carried = {r["name"] for r in con.execute("PRAGMA table_info(item)")}
        if "rarity" not in carried:
            con.execute("ALTER TABLE item ADD COLUMN rarity TEXT")
        if "uses" in carried:
            con.execute("ALTER TABLE item DROP COLUMN uses")
        for column, stat, sign in MOVED:
            if column not in carried:
                continue
            con.execute(
                "INSERT OR IGNORE INTO effect (item, stat, amount) "
                f"SELECT id, ?, ? || {column} FROM item "
                f"WHERE {column} IS NOT NULL AND trim({column}) <> ''",
                (stat, sign),
            )
            con.execute(f"ALTER TABLE item DROP COLUMN {column}")
        if "slot" not in carried:
            con.execute(
                "ALTER TABLE item ADD COLUMN slot TEXT "
                "CHECK (slot IN ('helmet','chest','legs','feet','mainhand','offhand','ring'))"
            )
        con.execute(
            """INSERT INTO search(ref, entity, section, body)
               SELECT 'bota://' || kind || '/' || id || '#about', id, 'about', about
                 FROM entity
                WHERE trim(coalesce(about, '')) <> ''
                  AND 'bota://' || kind || '/' || id || '#about' NOT IN
                      (SELECT ref FROM search)"""
        )
        con.commit()
        item_sql = value("SELECT sql FROM sqlite_master WHERE type='table' AND name='item'") or ""
        if "REFERENCES entity" not in item_sql:
            con.execute("DELETE FROM item WHERE id NOT IN (SELECT id FROM entity)")
            con.commit()
            con.execute("PRAGMA foreign_keys = OFF")
            con.executescript(ANCHOR_ITEM)
            con.commit()
            con.execute("PRAGMA foreign_keys = ON")
    finally:
        con.close()
    return CANON_DB


@contextmanager
def writing():
    con = connect()
    try:
        yield con
        con.commit()
        con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        con.close()


def rows(sql, args=()):
    con = connect(readonly=CANON_DB.exists())
    try:
        return con.execute(sql, args).fetchall()
    finally:
        con.close()


def row(sql, args=()):
    found = rows(sql, args)
    return found[0] if found else None


def value(sql, args=(), default=None):
    found = row(sql, args)
    return found[0] if found else default


def link(kind, ident, fragment=None):
    return f"bota://{kind}/{ident}" + (f"#{fragment}" if fragment else "")


def targets(text):
    return [(kind, ident, frag or "") for kind, ident, frag in LINK.findall(text or "")]


def mentioned(text):
    return {ident for _, ident, _ in targets(text)}
