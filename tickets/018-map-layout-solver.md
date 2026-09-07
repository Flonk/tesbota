# 018 — solve a layout from the graph

**Status:** done
**Depends on:** 017

## What

`tesbota/mapping.py`: turn the place graph into `{id: {x, y, fixed}}`, deterministically.

- Seeded, so the same world always produces the same map. A map that shuffles every
  refresh is unreadable and untrustworthy.
- Constraints, in order of strength: a known `extent` pins a place absolutely; a
  bearing fixes the angle between two places; a distance band fixes the range; a
  `within` edge keeps children inside their parent's region; everything else repels
  everything else so labels have room.
- Unsolvable is a normal state. A place with no bearing and no distance to anything
  floats and must be marked as unplaced, not quietly dropped and not given a made-up
  position. Return `confidence` per place: `fixed`, `constrained`, `floating`.
- Plain iterative relaxation is enough. No dependency — this repo has four Python
  dependencies and should keep it that way.

Expose it as `tesbota map --json` alongside the existing mermaid output. Keep
`tesbota map` printing mermaid; that is what `canon.mermaid()` is for and the map
tab in the UI currently uses it.

## Done when

- the 15 known places solve, and the same seed gives the same coordinates twice
- Alheim's places land west or east of each other in line with their recorded
  bearings, not at random
- floating places are reported as floating

## Files

`tesbota/mapping.py` (new), `tesbota/cli.py`
