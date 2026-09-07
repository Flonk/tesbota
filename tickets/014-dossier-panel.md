# 014 — clicking a thing opens its dossier

**Status:** done
**Depends on:** 009

## What

A dossier panel, opened from any library row and from any `bota://` link anywhere in
the app. It shows, for any entity:

- name, kind, when it was introduced, and its address, copyable
- **what is written** — its claims, by section, each with the turn it came from
- **referenced in** — every document that mentions it, as links, with snippets
- **what it keeps** — its holdings (004)
- for **places**: the containment chain up, what it contains, and its exits with
  bearings and distances
- for **people**: what they wrote
- for **items**: who holds it

Where a fact is missing, say what is missing rather than rendering an empty box —
"nothing written yet" is real information in this world, and `tesbota gaps` treats
it as the backlog.

Open it as an overlay panel over the tab area rather than a route, so the story
column stays put; it must be closable with Escape and with a click outside.

## Done when

- opening the mill's dossier from three different places gives the same panel
- an unwritten entity's dossier is honest and not empty-looking

## Files

`web/app/Dossier.jsx` (new), `web/app/Library.jsx`, `web/app/page.jsx`,
`web/app/globals.css`
