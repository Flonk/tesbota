# 021 — the map only shows what has been found out

**Status:** todo
**Depends on:** 019

## What

A place the explorer has never been and no document describes should not be drawn
the same as Alheim.

Three states, from the data that already exists:

- **walked** — it appears in some turn's `location_path`. Solid.
- **recorded** — something written mentions it, but the explorer has not been. Dimmer.
- **named only** — it is in `unwritten`; somebody named it and nobody wrote it. A
  dashed outline and nothing inside.

Derive "walked" by scanning the turn records, and cache it on the campaign rather
than re-scanning every render.

This is not a game mechanic and must not hide anything from Flo — everything stays
visible and clickable. It is about making the shape of what is known legible at a
glance, which is the whole point of a map in a world like this one.

## Done when

- the road, the mill, the inn and Alheim read as walked; Virtu and Hindmarsh do not
- nothing is hidden, only weighted

## Files

`web/app/Map.jsx`, `tesbota/mapping.py`, `web/lib/store.js`
