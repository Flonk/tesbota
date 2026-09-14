# 023 — apparel subtypes and equipment slots

Items have a `type` (`weapon`, `apparel`, `consumable`, `tool`, `valuable`, `material`).
Apparel needs subtypes, and anything wearable or wieldable needs to say which slot it
occupies, because the inventory UI (ticket 024) draws a body with slots on it.

## The contract other tickets rely on

Add a `slot` column to `item`. One of, and nothing else:

    helmet  chest  legs  feet  mainhand  offhand  ring

`slot` is null for anything that is not worn or held in a hand — a loaf, a coin, flour.
`holding.worn = 1` continues to mean *this is the one actually being worn or wielded*,
so a spare shirt in the pack is `worn = 0` with `slot = 'chest'`.

## Scope

- `tesbota/db.py`: `item.slot`, added by inline migration the way `person.born` was.
- `tesbota/config.py`: `SLOTS` tuple in the order above, and `RING_SLOTS = 4`.
  Extend `ITEM_TYPES` so `apparel` and `weapon` document that they carry a slot.
- Backfill the live `canon.db`: travelling clothes → `chest`, walking boots → `feet`,
  the walking cane in `STARTING_INVENTORY` → `mainhand`. Nothing else gets a slot.
- `STARTING_INVENTORY` entries gain `slot` where they have one.
- `tesbota/cli.py`: the `data --json` payload's `items` list gains the slot vocabulary,
  and `kit` rows carry their slot.
- `tesbota/prompts/writing.md` and `common.md`: the column exists, what the values are,
  and that a thing with no slot simply has none. Two sentences, no essays.
- `web/app/Data.jsx`: the **items** list shows the slot column. Do not add a new list
  tab and do not touch `web/app/page.jsx` — ticket 024 owns that file.

## Out of scope

The paper-doll UI (024) and combat (025).

## Done when

`tesbota data --json` reports slots, the live DB has the three backfills, and
`sqlite3 canon.db "SELECT id, type, slot FROM item"` reads sensibly.
