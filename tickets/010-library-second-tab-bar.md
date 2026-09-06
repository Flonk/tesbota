# 010 — the library gets its own tab bar

**Status:** done
**Depends on:** 009

## Why

The library is one flat list of books. The world has people, places and items too,
and they are what the map and the dossier hang off.

## What

A second tab bar inside the `library` tab: **places · people · books · items**.

- It sits under the main tab bar and must not look like a second copy of it — the
  main bar is the app's, this one is the panel's. Lighter, smaller, no pips.
- Reuse the existing `.tab` styling vocabulary rather than inventing a parallel one.
  `globals.css` already has the density this app is built at; match it.
- Remember the selected sub-tab across a poll refresh, and across a reload if that
  is free (`localStorage`), but never at the cost of a flash of the wrong tab.
- Each tab shows a count.

The existing `/api/library` stays for books. Add `/api/entities?kind=` for the other
three, or widen `library()` — either is fine, pick one and be consistent.

## Done when

- all four tabs render, with counts, at the density of the rest of the app
- the bar does not blow the panel out on a narrow screen — the main tab bar already
  had this fixed once (`2fc5a82`), do not regress it

## Files

`web/app/Library.jsx`, `web/app/globals.css`, `web/app/api/`
