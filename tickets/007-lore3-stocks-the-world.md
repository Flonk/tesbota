# 007 — lore master 3 can say what a place or a person keeps

**Status:** todo
**Depends on:** 004

## Why

Nothing has anything until the game master hands it over. A mill should already have
sacks in it the first time anyone walks in.

## What

- Teach `LORE3_SYSTEM` the `holding` table, with the same discipline the rest of its
  prompt uses: what a place keeps is a fact about the place and belongs to whoever
  is writing that place, and it should be written when the place is written rather
  than as a separate errand.
- Its gate already allows writing anywhere in canon, so no permission change.
- Add `holding` to the `READING` block shared by every layer, so the game master and
  both lore masters can see what anybody keeps.
- `tesbota gaps`: a person or place with no holdings is not a gap. Do not add one.

## Done when

- a lore session that writes a shop writes its stock in the same breath
- every layer's `READING` block documents `holding`

## Files

`tesbota/prompts.py`
