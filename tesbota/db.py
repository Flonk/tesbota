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
  id    TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
  lives TEXT,
  work  TEXT,
  born  TEXT,
  died  TEXT
);

CREATE TABLE IF NOT EXISTS passage (
  book_id TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  ord     INTEGER NOT NULL,
  text    TEXT NOT NULL,
  PRIMARY KEY (book_id, ord)
);

CREATE TABLE IF NOT EXISTS edge (
  src      TEXT NOT NULL,
  rel      TEXT NOT NULL CHECK (rel IN ('within','exits')),
  dst      TEXT NOT NULL,
  bearing  TEXT,
  distance TEXT,
  PRIMARY KEY (src, rel, dst)
);
CREATE INDEX IF NOT EXISTS edge_dst ON edge(dst, rel);

CREATE TABLE IF NOT EXISTS holding (
  id       INTEGER PRIMARY KEY,
  holder   TEXT NOT NULL,
  name     TEXT NOT NULL,
  qty      INTEGER NOT NULL DEFAULT 1,
  note     TEXT,
  worn     INTEGER NOT NULL DEFAULT 0,
  turn_id  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS holding_once ON holding(holder, lower(name));
CREATE INDEX IF NOT EXISTS holding_holder ON holding(holder);

CREATE VIEW IF NOT EXISTS writing AS
  SELECT 'bota://books/' || p.book_id || '#p' || p.ord AS ref,
         p.book_id AS entity, 'books' AS kind, 'passage' AS section, p.text AS body
    FROM passage p
  UNION ALL
  SELECT 'bota://' || e.kind || '/' || e.id || '#about',
         e.id, e.kind, 'about', e.about
    FROM entity e WHERE e.about IS NOT NULL AND trim(e.about) <> '';

CREATE VIEW IF NOT EXISTS unwritten AS
  SELECT e.id, e.kind, e.name FROM entity e
   WHERE e.id <> 'the-explorer'
     AND NOT EXISTS (
     SELECT 1 FROM writing w
      WHERE w.entity = e.id AND trim(w.body) <> '$BOTA'
   );

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

CREATE TRIGGER IF NOT EXISTS entity_about_ai AFTER UPDATE OF about ON entity BEGIN
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


def setup():
    CANON_DB.parent.mkdir(parents=True, exist_ok=True)
    con = connect()
    try:
        con.execute("PRAGMA journal_mode = WAL")
        con.executescript("DROP VIEW IF EXISTS writing; DROP VIEW IF EXISTS unwritten;")
        con.executescript(SCHEMA)
        shape = {r["name"] for r in con.execute("PRAGMA table_info(entity)")}
        if "extent" not in shape:
            con.execute("ALTER TABLE entity ADD COLUMN extent TEXT")
        if "about" not in shape:
            con.execute("ALTER TABLE entity ADD COLUMN about TEXT")
        held = {r["name"] for r in con.execute("PRAGMA table_info(person)")}
        for column in ("born", "died"):
            if column not in held:
                con.execute(f"ALTER TABLE person ADD COLUMN {column} TEXT")
        con.commit()
        person_sql = value("SELECT sql FROM sqlite_master WHERE type='table' AND name='person'") or ""
        if "lives TEXT REFERENCES" in person_sql:
            con.execute("PRAGMA foreign_keys = OFF")
            con.executescript(FREE_LIVES)
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
