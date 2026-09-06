# 009 — one endpoint that knows everything about one thing

**Status:** done

## Why

The library tabs (010–013) and the dossier (015–017) all need the same bundle, and
it should be assembled once, in SQL, not stitched together in React.

## What

`web/app/api/entity/[id]/route.js`, reading `canon.db` through the existing
`DatabaseSync` helper in `web/lib/store.js`. Return:

- the `entity` row: id, kind, name, introduced
- `claims` — every claim against it, by section
- `mentions` — every `writing` row whose body contains `/<id>`, with ref and a
  snippet, so "referenced in" is a real list
- `holdings` — what it keeps (004)
- for `places`: `within` (its parent chain via the recursive query already in
  `canon.ancestry`), `contains`, and `exits` with bearing and distance
- for `people`: books where `author_id` is them
- for `books`: the `book` row and every `passage` in order
- `unwritten` — whether it has nothing written against it
- `stub` — whether any of its writing contains `$BOTA`

Add a matching `entity(id)` to `web/lib/store.js` so the page can call it server
side too. Keep the read-only open; nothing in the web layer ever writes canon.

## Done when

- `/api/entity/alheim-mill` and `/api/entity/petra-voll` both return full bundles
- an unknown id returns 404, not a 500

## Files

`web/app/api/entity/[id]/route.js`, `web/lib/store.js`
