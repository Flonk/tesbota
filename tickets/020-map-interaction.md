# 020 — move around the map

**Status:** done
**Depends on:** 019, 014

## What

- Pan by dragging, zoom by wheel and pinch, with sane limits and a reset.
- Clicking a place opens its dossier (014).
- Hovering a road shows its bearing and distance, and says plainly when the distance
  is unrecorded — "nobody has measured this" is the honest label and it is most of
  the roads in this world.
- The explorer's marker is always findable: a control that centres on it.
- The map keeps its position across a poll refresh. `page.jsx` polls; do not let a
  refresh yank the view back to origin.

## Done when

- panning and zooming feel right on a trackpad and on a phone
- a poll refresh does not move the view

## Files

`web/app/Map.jsx`
