# 022 — bring the README back in line

**Status:** done
**Depends on:** everything above

## Why

The README is the design document for this system and it is currently ahead of the
code in one place and behind it in several.

## What

- **The narrator** section describes an agent that no longer exists. Rewrite it as
  what it is: an append log, godhead-class, one passage per turn, linked
  deterministically. Keep the honest note about self-certification from 001 — the
  README is where the trade-offs of this system are recorded and that is one.
- The layer table's Narrator row: it is not a session and not an agent. Say so.
- **Cost**: the narrator is no longer a call. Correct it.
- Document `holding` in the canon layout block and in the layer's `READING` section.
- Rewrite **Maps** for the two-layer model from 017.
- Document the new commands: `tesbota chronicle`, `tesbota holdings`, `tesbota map --json`.
- Add a short **Web interface** paragraph for the library tabs, the dossier and the map.

Match the existing voice — plain, declarative, explains why a thing is the way it is
rather than listing features. Do not turn it into a changelog.

## Done when

- nothing in the README describes code that does not exist
- a reader who has never seen this repo could rebuild the narrator from its section

## Files

`README.md`
