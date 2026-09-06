# 012 — search and filters across the library

**Status:** done
**Depends on:** 010, 011

## Why

`store.look()` already runs fts5 over `search` and nothing in the UI calls it.

## What

- A single search box above the sub-tab bar. Typing filters the current tab by name
  as you type, locally, with no round trip.
- Enter runs the full-text search through `store.look()` and shows hits across
  everything, with the matched snippet — `snippet(search, 3, ...)` is already wired
  up in `look()` and returns `<<` `>>` delimiters, so render those as marks.
- Filters per tab, as a row of toggles, not a dropdown:
  - all kinds: `unwritten`, `has $BOTA`
  - books: rarity, godhead, has an author row
  - places: orphan (no `within` edge), has exits, holds something
  - people: wrote something, mentioned somewhere
- Filters combine as AND, and the active set is visible at a glance. Clearing is one
  click.
- `/` focuses the search box, Escape clears it.

## Done when

- searching `mill` finds the mill, the sawmill, and the passages that mention them
- an fts5 syntax error in the box shows as a quiet inline note, not a crash —
  `look()` already returns `{error}` for this, handle it

## Files

`web/app/Library.jsx`, `web/app/api/library/route.js`, `web/lib/store.js`
