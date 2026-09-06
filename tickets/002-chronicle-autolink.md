# 002 — deeplink the chronicle deterministically

**Status:** todo

## Why

The agent narrator resolved names to real entity ids. An append log does not, and
the game master is forbidden proper nouns by `GM_SYSTEM` ("a woman is loading a
cart", not "the reeve's daughter"), so raw narration carries no addresses at all.
Without links the chronicle is invisible to `writing`, to the `%/some-id%` lookups
every layer uses, and to the dossier in 015.

## What

Add `link_names(text)` to `tesbota/chronicle.py`, applied to a passage before it is
inserted.

- Build the candidate set from `entity(id, kind, name)`. Match on `name`, on `name`
  with a leading article stripped ("The Alheim Inn" also matches "Alheim Inn"), and
  on the id with hyphens as spaces.
- Longest match first, so "Alheim Mill" wins over "Alheim".
- Case-insensitive, but anchored on word boundaries — never match inside a word.
- Link the first occurrence of each entity per passage and leave the rest alone; a
  paragraph with the same link four times reads badly.
- Never match inside an existing `[...](bota://...)`, and never inside a quoted
  passage the game master copied out of a book.
- Emit `[the exact matched text](bota://<kind>/<id>)` so the sentence still reads
  with the author's own words, per the README's deeplink rule.

Entities the world has not named yet simply do not link. That is honest and it is
also what keeps lore master 3's backlog meaningful.

## Done when

- a passage mentioning Alheim, the Alheim Mill and the Alheim Inn links all three,
  to the right ids, with "Alheim Mill" not mangled into "[Alheim] Mill"
- re-running the linker over already-linked text is a no-op
- unit-checkable: add a `tickets/`-adjacent scratch check or a `__main__` block; no
  test framework exists in this repo, do not add one

## Files

`tesbota/chronicle.py`
