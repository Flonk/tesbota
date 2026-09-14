# 025 — combat as subturns, drafted

A fight is one turn of the world. Inside it, the fight plays out as a sequence of
subturns — blow, answer, blow — and the turn view should show that sequence rather
than a paragraph saying a fight happened.

**This ticket is a design, not an implementation.** Write
`tickets/025-combat-design.md` and stop. Do not change behaviour of a running game.

## Read first

`tesbota/steps.py` (the phase machine, `roll_check`, `roll_fate`, `deliver`),
`tesbota/driver.py`, `tesbota/prompts/gm.md`, `web/app/page.jsx` (how phases render as
folds), and `tickets/` for how earlier tickets were written.

## What the design must answer

- Where combat sits in the turn: the GM declares a fight, then what? Which existing
  state (`gm`, `lore1`, `lore2`, `explorer`) does it live in or beside?
- What a subturn is: one exchange, one check, one die? Who rolls, and against what?
  We have `roll_check` (d20 + skill bonus vs dc, with disadvantage when spent or
  starving) and weapons carrying `damage` like `1–2`.
- Who decides what the explorer does in a fight — one declared intent for the whole
  fight, or a decision per subturn? Weigh the cost: every per-subturn decision is an
  agent call.
- How it ends: fled, beaten, killed. Death already exists — `tesbota kill "<cause>"`.
  0 health already kills.
- What is stored on the turn record so the UI can draw it, and how it renders: a fold
  per subturn? a single fold containing the exchange? Sketch the markup.
- What the GM is told, as prompt text you would actually add to `gm.md`.

## Constraints

- No new agents. Combat must run inside the game master's existing call or calls.
- The driver rolls; the game master never rolls.
- Cheap: a fight should not cost ten agent calls.
- Say plainly what you would cut if it turns out too expensive.

## Done when

The design file exists, is under 400 lines, and someone could implement it without
asking a question.
