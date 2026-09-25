# Editing the record

Everything the detail view shows can be changed from it, and the library's
tables can be changed in place. Both go through one door: a **patch** sent to
`POST /api/edit`, which runs `tesbota edit <id> '<patch json>'`, which applies
every section of the patch in one transaction or none of it.

## The patch

A patch is an object of sections. A section that is absent is left alone. An
object section is merged field by field — only the fields named are written. A
list section replaces the whole list.

| section | shape | written to |
| --- | --- | --- |
| `entity` | `{ name, about }` | `entity` |
| `person` | `{ work, lives, born, died, traits }` | `person` |
| `body` | `{ health, damage, dc, bonus, defense, skill }` or `null` to take the fight stats away | `body` |
| `place` | `{ type, parent, lat, lon, width }` | `place` |
| `ways` | `[{ dst }]` — the doors out of the place, into what the map cannot show | `way` where `src` is the place |
| `orbit` | `{ semi_major, eccentricity, longitude, periapsis, mass, radius, oblateness, tilt, rotation, meridian }` | `orbit` |
| `item` | `{ type, slot, rarity, weight, worth, owed_by }` | `item` |
| `effects` | `[{ stat, amount }]` | `effect` for the item |
| `book` | `{ author, author_id, written, rarity }` | `book` |
| `passages` | `["text", …]` in order | `passage`, renumbered from 1 |
| `aspect` | `{ applies }` | `aspect` |
| `grants` | `["ability-id", …]` — what the aspect grants | `grants` where `aspect` is it |
| `ability` | `{ damage, advantage, cooldown, sleep, delay, spawn, within, in_kind, in_aspect }` | `ability` |
| `granted` | `["aspect-id", …]` — which aspects grant the ability | `grants` where `ability` is it |
| `tags` | `[{ aspect, value }]` — the aspects the thing carries | `tagged` where `entity` is it |
| `holdings` | `[{ item, qty, worn }]` — what a person or place keeps | `holding` where `holder` is it |

Rules every section keeps:

- An empty string is silence and is written as `NULL`. `$BOTA` is written as
  itself: it marks something owed, which is not the same as nothing.
- A reference (`lives`, `parent`, `author_id`, `dst`, an aspect, an ability, an
  item) must name an entity that exists and is of the right kind, or the whole
  patch is refused with a sentence saying which.
- A section refuses what its table's `CHECK` would refuse, and what a fight
  could not use — a damage band that does not read like `2-5`, a health or dc
  under 1, a defense under 0 — and says so in words before the database gets to.
- The chronicle — a book written by `The Narrator` — is the record of what
  happened and is never edited: every patch to it is refused.
- `entity.changed` is stamped on every successful edit.

The answer is `{ ok: true, id, wrong: [...] }`, where `wrong` is whatever
`tesbota check` now finds wrong that mentions the thing — shown as a warning, not
a refusal. A refusal is `{ error: "…" }`.

## Where the code lives

    cli/src/edit/index.ts        the command: dispatch, transaction, answer
    cli/src/edit/<section>.ts    one file per section, default export
                                 (con, id, value, ctx) => void, throws Error(words)
    web/app/api/edit/route.js    the door
    web/app/edit/fields.jsx      the pieces every editor is made of
    web/app/edit/<Kind>.jsx      one editor per kind, default export
                                 ({ thing, draft, change }) => JSX
    web/app/edit/Common.jsx      tags and holdings, which any kind can have

`ctx` is `{ kind, all }` — the entity's kind and the whole patch, for a section
that has to know what else is changing.

## The detail view in edit mode

The pen beside the close button turns editing on, the way the pen in the map
trail does. While editing:

- A bar under the head says what is happening — `editing`, and a gold dot once
  anything has changed — with `cancel` and `save` at its end. Ctrl Enter saves.
  Esc cancels, and asks first if anything has changed. Clicking outside the
  panel does not close it while there are changes.
- The name becomes an input in place; `about` becomes a textarea in place. Both
  are handled by the detail view itself.
- Below them the kind's editor renders in place of the kind's read-only
  sections, in the same order, under the same labels, so nothing moves when
  editing starts.
- A refusal shows under the bar in the warning colour; the draft is kept. A
  save that succeeds reloads the entry, leaves editing, and shows any `wrong`
  under the bar until the next edit.

`draft` is the patch being built. An editor reads `draft.section?.field ??
thing's value` and calls `change("section", value)`: for an object section the
value is merged into what is already in the draft, for a list section it
replaces it.

## Fields

`fields.jsx` holds the only inputs an editor uses, so every editor looks the same:

| piece | for |
| --- | --- |
| `<Field label value onChange />` | one line of text |
| `<Field kind="number" />` | a number; empty is `null` |
| `<Field kind="text" />` | a paragraph |
| `<Field kind="choice" options />` | one of a fixed list; the first option is empty |
| `<Pick label kind value onChange />` | an entity of one kind, chosen by name |
| `<Many label rows onChange columns blank />` | a list of rows, each a line of fields, with add and remove |
| `<Chips label values onChange />` | a list of words, like traits |
| `<Group label>` | a labelled block, the same as a read-only section |

Labels are the same words the read-only view uses.

## The library in edit mode

The library's table gets the same pen at the end of its search bar. In edit
mode the cells of the columns that are plain fields — a name, a trade, a type,
a rarity — become inputs; a changed row is marked with the gold dot; `save`
sends one patch per changed row. Counts and joined columns stay read-only.
