# the node cli

The world is moving here from `tesbota/`. What is already true:

- `src/machine.ts` — every state and every edge, declared once. A step does not
  assign its next state; it returns an edge name and the machine looks it up, so
  an undeclared transition cannot be taken. `audit()` proves every state is
  reachable, every edge lands somewhere real, and no two edges share a pair of
  states — which is what lets a watcher name an edge from the outside.
- `src/schema.ts` — zod. One shape for a turn, one for a campaign, parsed at
  every boundary. Bodies are held by id, never as objects: keeping the object
  worked in memory and broke the moment a turn went to disk and came back.

Run `node src/machine.ts` to print the table and audit it. Node 24 strips the
types, so there is no build step.

Still in Python and still to move: canon, prompts, the agent calls, the steps
themselves, and the driver loop. Until then `tesbota/machine.py` does not exist —
`tesbota/steps.py` holds the same states and `tesbota/driver.py` records which
edge it crossed on `turn.took`, which is what the dev tab lights up.
