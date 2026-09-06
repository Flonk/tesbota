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
  introduced TEXT
);

CREATE TABLE IF NOT EXISTS book (
  id      TEXT PRIMARY KEY REFERENCES entity(id) ON DELETE CASCADE,
  author    TEXT NOT NULL,
  author_id TEXT REFERENCES entity(id),
  written   TEXT,
  rarity    TEXT
);

CREATE TABLE IF NOT EXISTS passage (
  book_id TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  ord     INTEGER NOT NULL,
  text    TEXT NOT NULL,
  PRIMARY KEY (book_id, ord)
);

CREATE TABLE IF NOT EXISTS claim (
  id        INTEGER PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  section   TEXT NOT NULL CHECK (section IN ('witnessed','attested','map')),
  turn_id   TEXT,
  text      TEXT NOT NULL,
  book_id   TEXT REFERENCES entity(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS claim_once ON claim(entity_id, section, text);
CREATE INDEX IF NOT EXISTS claim_entity ON claim(entity_id, section);

CREATE TABLE IF NOT EXISTS edge (
  src      TEXT NOT NULL,
  rel      TEXT NOT NULL CHECK (rel IN ('within','exits')),
  dst      TEXT NOT NULL,
  bearing  TEXT,
  distance TEXT,
  PRIMARY KEY (src, rel, dst)
);
CREATE INDEX IF NOT EXISTS edge_dst ON edge(dst, rel);

CREATE VIEW IF NOT EXISTS writing AS
  SELECT 'bota://books/' || p.book_id || '#p' || p.ord AS ref,
         p.book_id AS entity, 'books' AS kind, 'passage' AS section, p.text AS body
    FROM passage p
  UNION ALL
  SELECT 'bota://' || e.kind || '/' || c.entity_id || '#c' || c.id,
         c.entity_id, e.kind, c.section, c.text
    FROM claim c JOIN entity e ON e.id = c.entity_id;

CREATE VIEW IF NOT EXISTS unwritten AS
  SELECT e.id, e.kind, e.name FROM entity e
   WHERE NOT EXISTS (
     SELECT 1 FROM writing w
      WHERE w.entity = e.id AND w.section <> 'witnessed' AND trim(w.body) <> '$BOTA'
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

CREATE TRIGGER IF NOT EXISTS claim_ai AFTER INSERT ON claim BEGIN
  INSERT INTO search(ref, entity, section, body)
  VALUES ('bota://' || (SELECT kind FROM entity WHERE id = new.entity_id) || '/' || new.entity_id || '#c' || new.id,
          new.entity_id, new.section, new.text);
END;
CREATE TRIGGER IF NOT EXISTS claim_ad AFTER DELETE ON claim BEGIN
  DELETE FROM search WHERE ref LIKE '%/' || old.entity_id || '#c' || old.id;
END;
CREATE TRIGGER IF NOT EXISTS claim_au AFTER UPDATE ON claim BEGIN
  DELETE FROM search WHERE ref LIKE '%/' || old.entity_id || '#c' || old.id;
  INSERT INTO search(ref, entity, section, body)
  VALUES ('bota://' || (SELECT kind FROM entity WHERE id = new.entity_id) || '/' || new.entity_id || '#c' || new.id,
          new.entity_id, new.section, new.text);
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
        con.executescript(SCHEMA)
        con.commit()
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
