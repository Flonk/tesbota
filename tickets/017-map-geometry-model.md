# 017 — decide what the map is allowed to know

**Status:** todo

## Why

The README is deliberate about this and it should stay deliberate: *"Geometry is
deliberately absent. Nothing here knows where anything is in metres, and coordinates
would mean inventing precision nobody established."* Flo's note agrees — very little
of Alheim or the Greater Plains is known, but the extent of Alheim Forest is.

So the map is not a stored thing. **The map is a projection of the graph**, solved
fresh from `within` and `exits`, plus the rare piece of real geometry the world has
actually established.

## What

Two layers, kept strictly apart.

**Derived, never stored.** Bearings and distances already on `exits` edges are the
only spatial facts most places have. Normalise them into something solvable:

- bearing text → degrees (`north` → 0, `north-east` → 45, …), unknown → null
- distance text → a coarse band with a low and high in metres, wide on purpose:
  "a short walk" → 200–1200, "5 km" → 5000–5000, "half a day" → 15000–30000,
  unknown → null. Put the table in `tesbota/travel.py`, which already owns leagues
  and journey timing.

**Established, stored.** Add an optional `extent` for places whose size a document
genuinely records, as GeoJSON in a text column:

```sql
ALTER TABLE entity ADD COLUMN extent TEXT;
```

Only lore master 3 may write it, and only when a document in the world measures the
thing — the Council measures roads, a survey plate has a boundary on it. The same
rule the README already applies to distances: *"a number belongs there only where
somebody in the world actually measured it, and the attested claim says who."* A
place with no `extent` is not a defect and must never be given one to make the map
look better.

## Done when

- `bearing_degrees()` and `distance_band()` exist, with the vague cases returning
  null rather than a guess
- `extent` exists, is null everywhere, and `LORE3_SYSTEM` documents when to write it
- the README's Maps section is updated to describe both layers

## Files

`tesbota/travel.py`, `tesbota/db.py`, `tesbota/prompts.py`, `README.md`
