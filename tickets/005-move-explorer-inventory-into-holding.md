# 005 — the explorer holds things the same way everyone else does

**Status:** done
**Depends on:** 004

## Why

Two inventory systems is one too many.

## What

- Migrate `campaign["inventory"]` into `holding` under `the-explorer` once, on load,
  the way `load_campaign` already upgrades string inventories to dicts. Leave the
  key in `campaign.json` until the migration has run, then stop reading it.
- `steps.apply_inventory` writes through `canon.give`/`canon.take` instead of
  mutating the campaign dict.
- `sheet.py`, `tesbota inventory`, `prompts.render_inventory` and the web
  `store.snapshot()` all read from `holding`.
- The explorer's `tesbota inventory` command must keep working under its permission
  callback — it shells out to the CLI, so nothing about the gate changes, but check
  it still runs.

## Watch for

`STARTING_INVENTORY` seeds a new campaign. Move that seeding to `tesbota init` so a
fresh world writes it into `holding` rather than into `campaign.json`.

## Done when

- `tesbota inventory` prints the same four starting items it does today
- `campaign.json` no longer carries an `inventory` key on a world that has stepped
- nothing reads `campaign["inventory"]` any more

## Files

`tesbota/steps.py`, `tesbota/sheet.py`, `tesbota/state.py`, `tesbota/cli.py`,
`tesbota/prompts.py`, `web/lib/store.js`
