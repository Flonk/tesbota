# 024 — an inventory tab with a body on it

The adventurer's tab (`CORDA`, id `me`) has `stats` and `quests`. Add `inventory`
between them: a character screen, not a table.

## Layout

Two halves. On mobile they stack, on a wide screen they sit side by side — use the
existing `.pair` grid, which already does this.

**Left: the body.** Slots drawn as labelled boxes in a column:

    helmet
    chest            mainhand
    legs             offhand
    feet             ring ×4

Each slot shows the item worn there (`holding.worn = 1` and the item's `slot` matches)
or reads empty. A filled slot opens that item's dossier on tap, like every other row in
this app. Use the item type's icon — `ICON` in `web/app/Data.jsx` — beside the name.

**Right: everything carried.** The same `Table` component the sheet uses today for
`carrying`: name, count, condition. Rows open the dossier.

## Scope

- `web/app/page.jsx`: the new sub-tab (icon `box`), routing, and the panel.
- A new `web/app/Kit.jsx` (or similar) for the body view.
- `web/app/globals.css`: the slot styling. Match the app — dense, mono labels,
  `var(--line)` borders, no rounding beyond what is already used.
- Move `carrying` out of `web/app/Sheet.jsx`, so stats is condition/abilities/skills
  and inventory owns what they carry.

## Depends on

Ticket 023 for `item.slot`. Until that lands, read the field defensively: a row with
no slot is simply not equipped anywhere.

## Do not touch

`tesbota/` at all — this is a UI ticket. `web/app/Data.jsx` belongs to 023.

## Done when

Corda › inventory draws the body, the two apparel rows she wears land in `chest` and
`feet`, every other slot reads empty, and the right half lists what she carries.
