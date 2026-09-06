# 013 — drive the library from the keyboard

**Status:** done
**Depends on:** 011, 012

## What

Arrow keys move the selection, Enter opens the dossier, Escape closes it, `[` and
`]` move between sub-tabs. Selection is visible without being loud.

Do not capture keys while the search box or the lore master's chat box has focus —
`page.jsx` already has a text box that must keep working.

## Done when

- the whole panel is usable without the mouse
- typing in the lore master chat still types

## Files

`web/app/Library.jsx`, `web/app/page.jsx`
