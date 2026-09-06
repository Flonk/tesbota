# 011 — dense lists for places, people and items

**Status:** todo
**Depends on:** 010

## What

One list component, three configurations. Per row: name, and the two or three facts
that actually distinguish that kind.

- **places** — parent, how many places it contains, how many exits, whether it holds
  anything
- **people** — how many books they wrote, how many documents mention them, whether
  they hold anything
- **items** — where it is (its holder, if any), how many documents mention it

Mark unwritten rows and `$BOTA` rows the way the map already marks them: dashed or
dimmed, not a badge. Rows are one line each. This is a reference panel, not a feed —
it should fit forty rows on a laptop screen without scrolling feeling like work.

Sort: alphabetical by default, with a click-to-sort on each column that matters.

## Done when

- forty rows fit and stay readable
- unwritten and stub rows are visually distinct without adding chrome

## Files

`web/app/Library.jsx`, `web/app/globals.css`
