# 019 — draw it

**Status:** todo
**Depends on:** 018

## What

Replace `web/app/Map.jsx`, which is 17 lines of mermaid, with an SVG map.

- Black ground. This world is fog and mostly unwritten, and an empty map should look
  like an unlit one, not like a broken one.
- Places as markers, sized by what they contain, labelled. Roads as lines along
  `exits`, labelled with their distance where one is recorded.
- Containment as soft regions behind the markers, nested — the mermaid version drew
  these as subgraphs and that reading is worth keeping.
- A place with a real `extent` is drawn as its actual shape. Everything else is a
  marker: the map should make it obvious at a glance how little is known, because
  that is the truth about this world.
- Floating places sit in a gutter at the edge, listed, not scattered into the middle
  pretending to have a position.
- Unwritten places dashed, matching `canon.mermaid()`'s `classDef unwritten`.
- The explorer's current position marked, from `campaign.location_path`.

Inline SVG, no library. The app has three dependencies and a dense hand-built look;
a charting library would fight it.

## Done when

- the current 15 places render legibly on a laptop and on a phone
- an empty world renders as black with nothing on it and does not look broken
- Alheim Forest, once it has an extent, draws as an area

## Files

`web/app/Map.jsx`, `web/app/globals.css`
