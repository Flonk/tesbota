# 008 — read anybody's holdings from the terminal

**Status:** done
**Depends on:** 004

## What

`tesbota holdings [<entity>]` — with no argument, every holder that has anything,
grouped, in the dense two-column style `tesbota library` uses. With an entity id,
just that one.

`tesbota inventory` stays exactly as it is: it is the explorer's own command, it is
on the permission allowlist, and its output shape must not change.

## Done when

- `tesbota holdings` and `tesbota holdings alheim-mill` both work
- `tesbota inventory` output is byte-identical to before

## Files

`tesbota/cli.py`, `tesbota/sheet.py`
