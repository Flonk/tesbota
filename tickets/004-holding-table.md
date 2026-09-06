# 004 — one table for everything anybody is holding

**Status:** done

## Why

Only the explorer can hold anything, and its inventory lives in `campaign.json`
outside canon entirely. Flo wants every person to have an inventory, and places to
have one too — a shop has stock, a room has things lying in it.

## What

Add to `tesbota/db.py` SCHEMA:

```sql
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
```

`holder` is an entity id — a person or a place — or the reserved id `the-explorer`.

The explorer has no `entity` row and must not get one: the README is explicit that
the one moving through this world is never an author and never a subject of the
library. So `holder` is deliberately not a foreign key. Add a `holders()` helper in
`canon.py` that reports which holders are entities and which is the explorer, and
exclude `the-explorer` from `unwritten`, `library` and `gaps`.

Helpers in `canon.py`: `holdings(holder)`, `give(holder, name, qty, note, worn)`,
`take(holder, name, qty)`, `transfer(src, dst, name, qty)`. Quantities stack
case-insensitively; taking more than is held empties the row rather than going
negative; taking what is not held is a no-op. Match the semantics already in
`steps.apply_inventory` exactly — that behaviour is deliberate.

## Done when

- the table exists and the helpers round-trip
- `the-explorer` never appears in `tesbota gaps`, `tesbota library` or `unwritten`

## Files

`tesbota/db.py`, `tesbota/canon.py`
