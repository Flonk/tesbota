# 001 — the narrator is an append log, not an agent

**Status:** todo

## Why

The narrator was built as a per-turn agent call with a 5.5KB system prompt. On a
single-action turn it did a person-swap and added one link; that is not worth an
agent. Flo's call: drop the agent, make it an append log.

## What

Rewrite `tesbota/chronicle.py` so `write(turn, ...)` composes the passage in Python
from the turn's own record and inserts it directly. No `ask()`, no SDK, no
permission gate.

- One passage per finished turn, built from the turn's `phases`: every entry with
  `who == "gm"` and non-empty text, joined into one paragraph in phase order.
  Explorer utterances are not passages; they are what prompted them.
- Store the game master's text verbatim. Do not attempt a second-to-third person
  rewrite — it cannot be done reliably with string work and a half-done one reads
  worse than none.
- Keep the book's identity exactly as it is: `the-life-of-explorer-1`, author
  `The Narrator`, godhead-class, `rarity` unique. `ensure_book()` stays.
- `step_narrate` stays a step so the turn cycle is unchanged, but it can no longer
  fail on an agent — drop `narrate_retries`, `MAX_NARRATOR_RETRIES` and
  `chronicle_failed`. It composes, inserts, records `turn["chronicle"]`, goes `done`.
- Delete `NARRATOR_SYSTEM`, `narrator_turn`, `render_phases`, `render_tail` from
  `tesbota/prompts.py`. Delete `NARRATOR_TABLES` and `MAX_NARRATOR_RETRIES` from
  config. Drop `MODELS["narrator"]`.
- Leave the `tables=` write allowlist in `gate.py`. It is now unused but it is
  correct and cheap, and 007 wants it.

## Known consequence, do not re-litigate

With no agent, the passages are the game master's own approved prose entering a
book that lore master 1 treats as law. That is self-certification and it is a real
loss of separation. It was weighed and accepted: the prose was already adjudicated
claim-by-claim before delivery, so nothing enters the book that lore master 1 did
not already pass. Record it here; do not redesign around it.

## Done when

- `grep -rn "MODELS\[.narrator.\]\|NARRATOR_SYSTEM\|narrator_turn" tesbota/` is empty
- a turn can be narrated with no network: passages appear with no agent call
- `.venv/bin/python -c "import tesbota.cli"` is clean

## Files

`tesbota/chronicle.py`, `tesbota/steps.py`, `tesbota/prompts.py`, `tesbota/config.py`
