# 025 — combat as subturns, the design

A fight is one turn. Inside it the fight is a **roll sheet** the driver produces with no
agent at all, and the game master is paid exactly one extra call to put words on it.
That is the shape this machine already uses everywhere else — the game master says what
the numbers are, the driver rolls them, the game master is told what the dice did and
narrates that — run six times inside one turn instead of once.

## Where it sits in the turn

The state machine gains one state. `STEPS` becomes:

    explorer → propose → gm → muster → fight ⇄ swing → blows → deliver
                                               └── once per blow ──┘

`step_gm` is unchanged except for its last line: if the draft it got back carries a
`fight` key, the next state is `muster` instead of `lore1`. Everything else — the
proposal, the six outcomes, `chosen`, `PRESS`, the inventory and holdings blocks — runs
exactly as it does now. A fight is a thing an ordinary turn turns into, not a mode the
world enters.

`step_swing` is one explorer call on the existing `sessions["explorer"]` — it asks what
they do and parses one word back. `step_fight` calls no agent: it rolls what they chose,
appends it to the roll sheet on the turn, and goes back to `swing` unless the fight has
ended. The two states alternate until an ending is reached, at most `MAX_BLOWS` times.

`step_blows` is then one game master call, on the existing `sessions["gm"]` with the
existing `GM_SYSTEM`, that turns the finished roll sheet into prose. There is no new
agent and no new prompt file — `prompts.gm_blows()`, `prompts.fight_open()` and
`prompts.fight_blow()` build user messages the way `prompts.gm_turn()` does.

The fight lives on the **turn**, in `turn["phases"]`, beside `check` and `outcomes`. It
is not lore1's business, it is not lore2's business, and it never touches the explorer's
session. The one piece of it that outlives the turn is an unfinished fight, which parks
on the campaign as `campaign["fight"]` (see *Broken*).

## What the game master declares

One new key on the draft it already returns:

```json
"fight": {
  "who": "jost-halm",
  "name": "Jost Halm",
  "health": 24,
  "damage": "2–5",
  "skill": "athletics",
  "dc": 12,
  "flee_dc": 10
}
```

`narration` on that same draft is the sentence before the first blow and nothing more.
It is the only thing in the fight that is adjudicated, and `step_muster` does it before
a die is thrown — that sentence plus the whole roster, every body with its health, its
damage and what it can do, through lore 1 and lore 2 once. FALSE sends the fight back to
be declared again; UNRESOLVED holds the world. Past the muster no lore master sees any
of it: a blow is a particular, and particulars were never theirs to rule on.

`health` is the thing's pool. `damage` is a band in the same notation the `item` table
uses — `"2–5"`, en dash or hyphen. `skill` is one of the eighteen in `SKILL_ABILITY`,
because `sheet.skill_bonus` returns `None` for anything else and `roll_check` would give
up. `dc` and `flee_dc` are integers; the game master is told `flee_dc` is always the
lower of the two.

## What a subturn is

**One subturn is one exchange, resolved by one d20.** Not one die each way — one die
that decides both directions, because two dice per blow doubles the roll sheet and buys
nothing the reader can feel.

`roll_check(campaign, turn)` already does the whole job: it reads `draft["check"]`, gets
the bonus from `sheet.skill_bonus`, throws an extra `SKILL_DIE` per limit the body is
at (`fatigue >= 100`, `hunger >= 100`) and keeps the lowest. `step_fight` sets
`draft["check"] = {"skill": fight["skill"], "dc": fight["dc"]}` and calls it once per
subturn. Disadvantage when spent or starving therefore falls out for free and needs no
new code: a starving explorer in a fight throws two dice per blow and keeps the worse,
six times running, and dies.

Per subturn:

- **pass** — the explorer lands it. Damage rolled from their weapon's band. Comes off
  `fight["health"]`.
- **fail** — the thing lands it. Damage rolled from `fight["damage"]`. Comes off
  `vitals["health"]`.
- **natural 20** (`check["roll"] == SKILL_DIE`) — the explorer's damage is rolled twice
  and added.
- **natural 1** — the thing's blow is the top of its band, not a roll.

The weapon is the explorer's worn weapon: the `canon.holdings(EXPLORER)` entry with
`type == "weapon"` and `worn` true, its `damage` read from the `item` row. Once ticket
023 lands that is the `mainhand` one. No weapon worn, or no `damage` on the row, and it
is `UNARMED = "1–2"` — the same as the walking cane, because fists are not worse than a
stick and nobody should have to rule on it. Parsing a band: split on `[–—-]`, two
integers, `rng.randint(low, high)`; anything that does not parse is `UNARMED`.

## Who decides what the explorer does

**The explorer decides every subturn.** It is their fight; they get to spend it.

What makes that affordable is that a fight subturn is not a turn. The explorer is asked,
it answers with one word, and the driver rolls. There is no propose call — the fight
already cost what it costs, and nothing in a subturn needs pricing. There is no lore
call — nothing has been asserted yet, because nobody has written any prose. The whole
exchange is adjudicated once, at the end, as one piece of narration.

So a subturn is **one agent call**, not four.

### What they are asked

The explorer keeps a session, so the options are laid out once and never again. On the
first subturn `prompts.fight_open(fight, choices)` sends:

```
Something is on you and you are in it now. Every time you are asked, answer with one
of these and nothing else:

  ATTACK          swing with the walking cane, 1–2 damage
  ITEM <name>     use one thing you carry, and it is gone
                    Bread from Alheim Mill — +15 health, −20 hunger
  SKILL <name>    go at it another way, with one of the eighteen
  FLEE            get out

It has 24 in it. You have 100. You will be told what happened and asked again.
```

Every subturn after that is one line, because the session already holds the rest —
`prompts.fight_blow(said)`:

```
You swung and missed, and it put 4 into you. 96 left of you, 24 left of it.
```

That is the whole message. The reply is parsed the way `first_utterance` already parses
an action: first line, uppercased, matched against the four verbs. Anything that does
not parse is `ATTACK`, because a body in a fight does not stand still, and a fight is
not a place to bounce a turn back for being unclear.

### What each choice does

| choice | rolled | landed | missed |
|---|---|---|---|
| `ATTACK` | `fight.skill` vs `fight.dc` | your weapon's band off it | its band off you |
| `SKILL <name>` | `<name>` vs `fight.dc` | your weapon's band off it | its band off you |
| `ITEM <name>` | nothing | the item's effects apply, and it is spent | — |
| `FLEE` | `fight.skill` vs `fight.flee_dc` | the fight ends `fled` | its band off you, and it goes on |

`SKILL <name>` is an attack made another way — a knife with `sleight of hand`, a stare
with `intimidation`, a shove with `athletics`. It is the same exchange at the same DC,
and the point of it is that a character's own numbers decide which verb is worth using:
`sheet.skill_bonus` is what changes, not the mechanic. A name that is not one of the
eighteen is `ATTACK`. This is what "use an ability" means in a world that has six scores
and eighteen skills and no powers.

`ITEM <name>` costs the subturn: nothing is rolled, the thing lands a blow unopposed,
and the item is spent through the ordinary ledger — a transaction to `the-godhead`, the
same as any consumable. A consumable is single use, so this is where the bread goes.
Naming a thing they do not hold is `ATTACK`.

**Tiredness and hunger need no new code.** `roll_check` already throws an extra `SKILL_DIE`
per limit the body is at and keeps the lowest, so a spent or starving explorer fights at
disadvantage on every one of these, six times running. That is the one place the cliff at
`>= 100` really bites, because `too_tired` is off inside a fight and fatigue can cross it
mid-exchange.

### The floor is still a floor

`FLEE_FLOOR = 25` stays, but it no longer decides for them — it **forces the question**.
At or below it the subturn message says so plainly:

```
You are hurt badly. 22 left of you.
```

They may still answer `ATTACK`. `MAX_BLOWS = 6` still ends an unsettled fight `broken`.

## How it ends

Checked after each subturn, in this order:

| `ended` | when |
|---|---|
| `killed` | `vitals["health"] - damage <= 0` |
| `beaten` | `fight["health"] <= 0` |
| `fled` | they answered `FLEE` and the `flee_dc` check passed |
| `broken` | `n >= MAX_BLOWS` |

`killed` is checked first: a dying explorer does not get the last word.

**The driver does not kill.** `step_blows` passes
`sqlite_gate(also=("tesbota kill", "tesbota traits"))` — the same gate `step_gm` already
uses — and the message tells the game master to run
`tesbota kill "<cause>"` before it replies. `driver.run` picks the death up from
`pending_death()` once the turn reaches `done` and calls `bury`.

One correction to the ticket's premise, found while reading: **0 health does not already
kill.** `apply_vitals` clamps health to 0 and nothing else happens; the only path to
death in the codebase is `actions.kill` → `record_death`. So the design closes it. In
`deliver`, after `apply_vitals`, if the fight ended `killed` and `pending_death()` is
empty, the driver calls `record_death(f"killed by {fight['name']}")` itself. The game
master gets the first chance to write the cause, and losing that chance does not mean
walking away from a fight at 0 health.

## What is stored, and how it renders

`step_blows` appends one phase of a new kind, `fight`:

```json
{
  "n": 4, "who": "gm", "kind": "fight", "status": "checked",
  "text": "<the opening line and every blow, joined with blank lines>",
  "minutes": 8, "fatigue": 18, "roll": 212, "check": null,
  "outcomes": [], "chosen": null, "transactions": [],
  "claims": [],
  "fight": {
    "who": "jost-halm", "name": "Jost Halm", "ended": "beaten",
    "weapon": "walking cane", "weapon_damage": "1–2", "damage": "2–5",
    "enemy_health": {"from": 24, "to": 0},
    "health": {"from": 100, "to": 82},
    "blows": [
      {"n": 1, "hit": true, "damage": 2, "enemy_health": 22, "explorer_health": 100,
       "check": {"skill": "athletics", "dc": 12, "roll": 14, "rolls": [14],
                 "against": [], "bonus": 2, "total": 16, "passed": true},
       "text": "The cane catches him across the forearm and he swears."}
    ]
  }
}
```

Each blow also carries `"chose": "ATTACK"` (or `"SKILL sleight of hand"`, `"ITEM Bread
from Alheim Mill"`, `"FLEE"`) so the UI can show what they picked beside what it cost
them — a fight the explorer steered should read as steered.

`blows[].check` is `roll_check`'s dict verbatim, so `<Check/>` renders it with no
change. `blows[].text` is the game master's line, matched back to the roll by index.
`text` on the phase is `"\n\n".join(opening + lines)` and is also `draft["narration"]`,
so `last_narration` and `chronicle.write` keep working untouched. `step_blows` delivers
straight from there — the claims and verdicts on the turn are the muster's, and the game
master is not asked for claims during blows at all.

`web/lib/store.js` needs no change — the phase map already spreads `...x`, so `fight`
survives to the client.

### Markup

`pairUp` pairs the explorer's `action` phase with the next `gm` phase, and a `fight`
phase is a `gm` phase, so the pairing is already right. `Pair` gets one branch: when
`told.fight` is set, draw `<Blows>` in place of the single `<Prose className="body
told">`.

One fold for the fight — the `Pair` fold it already has — and one row per subturn
inside it. Not a fold per subturn: six nested `<details>` is six clicks to read one
fight, and the sequence is the point.

```jsx
const END = {
  beaten: "they went down",
  fled: "you got out",
  killed: "you did not get out",
  broken: "it is not over",
};

function Blows({ f }) {
  return (
    <div className="fight">
      <p className="sec-label">
        {f.name} · {f.enemy_health.from} hp · {f.weapon} {f.weapon_damage} vs {f.damage}
      </p>
      {f.blows.map((b) => (
        <div className={`blow ${b.hit ? "landed" : "taken"}`} key={b.n}>
          <span className="blowno">{b.n}</span>
          <Prose className="body told" text={b.text} />
          <Check c={b.check} />
          <span className="blowtoll">
            {b.hit
              ? `−${b.damage} · ${b.enemy_health} left of them`
              : `−${b.damage} · ${b.explorer_health} left of you`}
          </span>
        </div>
      ))}
      <Note tone={f.ended === "beaten" || f.ended === "fled" ? "good" : "bad"}>
        {END[f.ended]}
      </Note>
    </div>
  );
}
```

`.blow` is a three-line stack with a left rule, `.landed` ruled in `--good` and `.taken`
in `--bad`, `.blowno` and `.blowtoll` in `--dim` at the caption size, alongside `.outrow`
in `globals.css`. `Check` already tones itself. `toll()` gains one line so the fold's
label says how long it went:

```js
if (x.fight) bits.push(`${x.fight.blows.length} blows`);
```

## What the game master is told

Add to `tesbota/prompts/gm.md`, after **# Action**. `fight` also goes into the json
block at the top of that file, as `"fight": null`.

```markdown
# Fights

When the explorer commits to violence, or something commits to it against them, do not
narrate the fight. Declare it and stop. Set `fight`, and let `narration` be the one
sentence before the first blow — who it is and what they are holding.

    "fight": {
      "who": "jost-halm",
      "name": "Jost Halm",
      "health": 24,
      "damage": "2–5",
      "skill": "athletics",
      "dc": 12,
      "flee_dc": 10
    }

`health` is how much it can take before it stops: 8 for a starved dog, 20 for a man with
a knife, 40 for something a village would warn you about. `damage` is what one of its
blows takes off, as a band, written the way the item table writes one.

`skill` is what the explorer is doing to it — `athletics` for a swung stick, `sleight of
hand` for a knife, `intimidation` for a fight that is really a stare. It must be one of
the eighteen. `dc` is how hard that is to land, on the usual ladder. `flee_dc` is how
hard the thing is to get away from, and it is always lower than `dc`.

Somebody running is not a fight. If they are leaving, set an ordinary `check` and let
them leave. A fight is an exchange both sides have committed to.

You do not roll it and you never write it. The explorer will be asked, blow by blow,
what they do — swing, use a thing they carry, go at it another way, or get out — and the
dice will answer them. It will all be handed back to you at the end, in order, and you
will be asked for the words then.
```

And the message `prompts.gm_blows(fight, blows, ended, fate)` sends, filled from the
roll sheet:

```
The fight has been rolled. They chose each of these, and this is what came of it, in
order, and it is settled:

  1  ATTACK — landed, 2 off Jost Halm, 22 left of him
  2  ATTACK — missed, he put 4 into you, 96 left of you
  3  ITEM Bread from Alheim Mill — eaten, +15 health; he put 3 into you, 108 left of you
  4  SKILL intimidation — landed, 2 off Jost Halm, 20 left of him
  5  FLEE — failed, he put 5 into you, 103 left of you
  6  ATTACK — landed, 3 off Jost Halm, 17 left of him

It ended: it is not over.

What they chose is theirs, not yours. Narrate the choice they made, not the one you
would have made for them.

Write one line for each numbered blow, in that order, second person, present tense. A
line is a clause or a short sentence — this is a fight, not a chapter. Say what the
numbers say. A landed blow lands and a missed one costs them. Do not soften a hit, do
not add a blow, do not take one away, and do not say how it ends before the last line.

Reply in the same json shape you always use, with `blows` in place of `narration`:

    {"blows": ["…", "…", "…"], "claims": [], "location": "kebab-id",
     "transactions": [], "quest_open": [], "quest_update": [], "quest_close": []}

`minutes`, `fatigue`, `health`, `check` and `fight` are not yours this time — the fight
already cost what it cost. `transactions` still are: what comes off a body, what breaks,
what is dropped.
```

Appended when `fate` landed, in place of the redraft that would normally carry it:

```
The dice also went hard against them, in the doing of this. Put it in the fight, in the
blow it belongs to — the strap goes, the footing goes, something arrives. Do not soften
it and do not undo a blow.
```

Appended when `ended == "killed"`:

```
It ended: you did not get out. They are dead. Before you reply, run:

    tesbota kill "beaten to death by Jost Halm at the ford"

The last line you write is the last line of their book. Write it as one.
```

## Numbers, and the two things that must not break

`tesbota/config.py`:

    MAX_BLOWS = 6
    FLEE_FLOOR = 25
    BLOW_MINUTES = 1
    BLOW_FATIGUE = 3
    UNARMED = "1–2"

The driver, not the game master, sets `draft["minutes"] = max(2, blows * BLOW_MINUTES)`,
`draft["fatigue"] = blows * BLOW_FATIGUE` and `draft["health"] = -(total taken)`, after
`step_gm` has already copied the proposal's numbers in. The game master never gets to
argue with the ledger.

Two existing pieces break unless they are told about fights:

- **`too_tired`** bounces a draft whose fatigue would cross `MAX_FATIGUE`, with *narrate
  that they cannot, and what resting here would take*. Mid-fight that is nonsense.
  `too_tired` returns `False` when the draft carries `fight`.
- **The roll block in `step_lore1`** would roll a seventh d20 and a d400 on top of the
  fight. `step_fight` calls `roll_fate(turn)` itself, which sets `turn["rolled"]`, and
  the block is skipped. Rolling fate *before* the blows call is the point: the calamity
  goes into the exchange in the same call, so a fight never pays the redraft that a
  normal turn pays when the d400 bites.

## Broken

`ended == "broken"` writes `campaign["fight"] = {...fight, "health": <what is left>}`.
`prompts.gm_turn` renders it above the action:

    The fight with Jost Halm is not over. He has 9 left in him.

The game master either declares the fight again with that `health` — carrying the pool
forward, which is the whole reason this is stored — or narrates it ending some other
way, in which case it omits `fight` and `deliver` clears `campaign["fight"]`. It is also
cleared on every non-broken ending and in `bury`.

## What it costs

Counted in agent calls, which is the only currency here.

| | ordinary turn | fight, 3 blows | fight, 6 blows |
|---|---|---|---|
| explorer | 1 | 1 | 1 |
| propose | 1 | 1 | 1 |
| gm | 1 | 1 | 1 |
| swing — one a blow | — | **3** | **6** |
| blows | — | **1** | **1** |
| lore1 + lore2 | 2 | 2 | 2 |
| redraft when the d400 bites | +3 (gm + 2 lore) | 0 | 0 |
| **typical** | **5** | **8** | **11** |

**A fight costs one call per blow, plus one.** A short fight is not much dearer than an
ordinary turn; a six-blow fight is about two turns' worth. That is what per-subturn
agency costs, and it is bought at the lowest price it can be had for: the swing calls
skip propose (nothing to price) and skip lore (nothing asserted yet), so a subturn is
one call rather than the four a real turn takes.

The tokens are small on top of that. Both the swing calls and the blows call ride
sessions that already exist, so the context is paid for. Each swing sends one sentence
and gets one word back; the roll sheet going up at the end is about forty tokens a blow.

The thing this design refuses is a *turn* per subturn — 6 × (explorer + propose + gm + 2
lore) = 30 calls for one fight. Agency per blow is affordable. A full turn per blow is a
different project.

## What I would cut, in order

1. **`MAX_BLOWS` from 6 to 3.** Now that every blow is an agent call, this is the knob
   that actually costs money: it halves the worst case from 11 calls to 8. It is one
   number in `config.py` and changes no code.
2. **The blows call.** Drop `step_blows` and the driver writes the lines itself from a
   small table of phrasings keyed on hit, miss, crit and fumble. Saves exactly one call
   and the fight reads like a combat log instead of prose — a much worse trade than it
   was before the explorer got a voice, because the prose is now the only part of the
   fight the explorer did not author. Reversible: the roll sheet, the phase record and
   the markup are all unchanged, only `blows[].text` gets worse.
3. **`SKILL` and `ITEM`.** Leave `ATTACK` and `FLEE` and the option list is two lines.
   Saves no calls, only the parsing and the item ledger — and it takes away the two
   choices that make the fight anything other than a coin flip, so it goes third.
4. **Never the swing calls.** Cutting those is cutting the thing that was asked for: an
   explorer who picks. A fight it does not steer is the old design, and that design is
   in this file's history if it is ever wanted back.
5. **Never the lore pass.** An unadjudicated fight invents a man, a billhook and a wound
   with nothing ruling on any of it, which is the one thing this machine exists to stop.
   If the budget will not carry the calls, cut the fight, not the check on it.

## Files an implementation touches

`tesbota/steps.py` (`step_fight`, `step_swing`, `step_blows`, `STEPS`, `too_tired`,
`deliver`), `tesbota/prompts.py` (`gm_blows`, `fight_open`, `fight_blow`, `gm_turn`'s
unfinished-fight block),
`tesbota/prompts/gm.md`, `tesbota/config.py`, `tesbota/state.py` (`campaign["fight"]`),
`tesbota/driver.py` (`bury` clears it), `web/app/page.jsx` (`Blows`, `Pair`, `toll`),
`web/app/globals.css`. Not `web/lib/store.js`.
