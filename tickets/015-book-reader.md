# 015 — read a book properly

**Status:** todo
**Depends on:** 014

## What

A book's dossier is a reader.

- Passages one at a time, large enough to actually read, with the passage number and
  the total.
- Left/right arrows, swipe on touch, and a jump to any passage. The turn navigation
  in `page.jsx` already solved this shape once — reuse its approach rather than
  inventing a second one.
- The book's author, date and rarity in the header; author links to their dossier.
  Mark a godhead-class author, since that is what makes the text law.
- Deeplinks inside a passage are clickable and open that dossier.
- `$BOTA` inside a passage renders as a visible unwritten marker, not as literal
  text — it is a promise somebody left, and `tesbota gaps` lists it.
- A whole-book view for reading straight through.

## Done when

- The Pocket Guide (12 passages) reads well both ways
- the chronicle reads as a chronicle
- `$BOTA` is unmistakable

## Files

`web/app/Dossier.jsx`, `web/app/globals.css`
