# 006 — the game master can move a thing from one holder to another

**Status:** done
**Depends on:** 004, 005

## Why

`gain`/`lose` only describe the explorer's side of an exchange, so paying a
shopkeeper makes a coin vanish rather than land in her till.

## What

Add `move` to the game master's reply shape:

```json
"move": [{"from": "greta-marsch", "to": "the-explorer", "name": "a loaf", "qty": 1}]
```

- `from` or `to` may be any entity id or `the-explorer`; either may be null for
  something entering or leaving the world (bread eaten, wood cut).
- Keep `gain`/`lose` working as shorthand for `move` with the explorer on one side;
  the prompt already teaches them and they are the common case.
- Apply through `canon.transfer` in `deliver`, alongside the existing calls.
- Extend `GM_SYSTEM`'s inventory paragraph: it is already told the explorer's list
  is the truth and it cannot spend what is not on it. Tell it the same about the
  person it is trading with — it must not invent stock into somebody's hands either,
  and it is shown what they hold when the explorer is dealing with them.

## Done when

- an exchange leaves the total unchanged: what the explorer loses, the other holder
  gains
- moving from a holder that does not have the thing is a no-op, not a negative row

## Files

`tesbota/steps.py`, `tesbota/prompts.py`
