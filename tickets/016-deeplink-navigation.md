# 016 — every address in the app is a link

**Status:** todo
**Depends on:** 014

## What

One renderer for prose containing `bota://` addresses, used everywhere prose is
shown: the story column, dossier claims, book passages, search snippets.

- `[the mill](bota://places/alheim-mill)` renders as the bracketed words, linked.
- A bare `bota://places/alheim-mill` also links, rendered as the entity's name where
  one exists and as the raw address where none does.
- An address pointing at no row renders as a dangling link — visibly so. Those are
  the world's frontier and `tesbota gaps` already lists them; the UI should agree.
- A `#p3` or `#c14` fragment opens the dossier at that passage or claim.

## Done when

- the chronicle's links (002) are clickable in the story column
- a dangling link looks dangling

## Files

`web/app/ui.jsx`, `web/app/page.jsx`, `web/app/Dossier.jsx`
