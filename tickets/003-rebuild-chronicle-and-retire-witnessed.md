# 003 — rebuild the chronicle, then retire `witnessed`

**Status:** done
**Depends on:** 001, 002

## Why

`canon.db` currently holds 9 passages written by the agent narrator before it was
dropped, and all 26 `witnessed` claims are still present. The migration was stopped
half-done on purpose. With 001 in place the backfill costs nothing, so it can just
be run.

## What

1. Delete every existing passage of `the-life-of-explorer-1` and clear `chronicle`
   from every turn file in `state/turns/`. The 9 agent passages go; they were
   written in a voice the append log will not reproduce and a half-and-half book is
   worse than either.
2. Rebuild: walk `all_turns()` in order, and for each turn where
   `chronicle.played(turn)` compose and insert its passage, saving `chronicle` back
   onto the turn file. All 25 played turns, deterministic, no calls.
3. Then `db.retire_witnessed()` — drops the 26 `witnessed` rows and rebuilds `claim`
   with `CHECK (section IN ('attested','map'))`.
4. Rewrite `cmd_migrate` in `cli.py` to do exactly the above with no `--no-backfill`
   flag; there is nothing left to opt out of.

## Watch for

- `retire_witnessed` deletes through the `claim_ad` trigger so `search` stays clean;
  do not switch it to a table-drop shortcut that skips the trigger
- the `unwritten` view changes meaning once witnessed rows are gone — entities that
  only ever had witnessed claims become unwritten, and `tesbota gaps` will grow. That
  is correct. Report the new count, do not suppress it.

## Done when

- `SELECT count(*) FROM claim WHERE section='witnessed'` is 0 and the CHECK is tight
- 25 passages in the book, in turn order
- `tesbota chronicle` reads as a continuous record
- `tesbota gaps` runs and its new size is reported in the commit or the run notes

## Files

`tesbota/cli.py`, `tesbota/chronicle.py`, `canon.db`
