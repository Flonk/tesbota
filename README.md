# tesbota

**The Eldest Scrolls: Boltzmann Tamagotchi.**

An adventurer wakes with no memory in a world that has not been written yet. It
asks where it is. Nobody knows. The world gets invented, one contested document
at a time, mostly while you are asleep.

## The layers

Each layer sees only what the driver hands it. The separation is structural, not
a rule anyone is asked to respect.

| Layer | Sees | Tools | Session |
|---|---|---|---|
| **Explorer** | Narration, nothing else | none | campaign-long |
| **Game master** | An action, a verdict | read | scene-scoped |
| **Lore master 1** | Bare claims | read | stateless |
| **Lore master 3** | A silence in the world | read/write | per sitting |

The Explorer has no file access at all, so the game master must reproduce book
text **verbatim** — and the driver diffs every quotation against its source file
before the Explorer sees it. It is the only assertion in the system that can be
checked with `==`.

Lore master 3 has never heard of an adventurer. It thinks it is cataloguing a
library.

## What is true

There is no codex and no omniscient narrator. `canon/` is a pile of markdown by
authors who are biased, mistaken, or lying, and they contradict each other
constantly. That is the texture, not a defect.

Exactly one thing is ground truth: the `## Witnessed` section of an entity file
— what the adventurer directly perceived. It cannot be contradicted. Everything
under `## Attested` is testimony and may be contradicted freely.

So lore master 1 returns four verdicts:

- **TRUE** — nothing contradicts it
- **FRICTION** — contradicts a document but not experience. Allowed. Interesting.
- **FALSE** — contradicts something Witnessed. The game master must revise.
- **UNRESOLVED** — the world is silent. Escalates to you.

Nothing becomes true by assertion, only by attribution. When you and lore master
3 fill a silence, you do not record a fact — you write a book, by a named author,
with a reason to be doubted.

A dangling `[[wikilink]]` is an unresolved fact. `tesbota gaps` lists the
frontier.

## Suspend and resume

Two states end a run. Neither costs anything to sit in, because nothing is
running: the state is a file, and the driver holds no memory between invocations.

- `awaiting_human` — the world is silent. Writes `pending/<turn>.md` and exits.
- `awaiting_clock` — the adventurer is travelling. Real hours, wall clock.

Journeys roll their *schedule* at departure but not their *content*: the driver
knows an interruption is due at +2h17m, and the game master invents what it is
when the moment arrives — so it can involve a book you wrote at midnight. During
an encounter the journey is held, the adventurer acts normally, and the road
resumes when the game master says so.

The driver checkpoints after every step, so a crash costs one call.

## Use

```
nix-shell
uv sync
uv run tesbota init
uv run tesbota step      # advance until something suspends
uv run tesbota status    # where things stand, how long until the adventurer wakes
uv run tesbota lore      # sit down with lore master 3 and end a silence
uv run tesbota gaps      # dangling links: the world's frontier
```

Make it tick on its own with a user timer:

```nix
systemd.user.services.tesbota = {
  Service.ExecStart = "${pkgs.uv}/bin/uv run --directory /home/claude/repos/personal/tesbota tesbota step";
};
systemd.user.timers.tesbota = {
  Timer = { OnCalendar = "*:0/5"; Persistent = true; };
  Install.WantedBy = [ "timers.target" ];
};
```

Polling is free — a step with nothing due reads one file and exits without
calling an agent.

## Cost

Lore masters are stateless and read narrowly. The game master is scene-scoped.
The Explorer's session is the only thing that grows, and it is re-sent in full on
every wake with a cold prompt cache, because real-hour gaps outlive any cache TTL.

That makes compaction the one thing that scales with the campaign — and
compacting the Explorer is the adventurer forgetting. Which, for a Boltzmann
brain, is not a compromise.

## Canon layout

`canon/{people,places,books,items}/<id>.md`, YAML frontmatter, wikilinks between
them. It is a valid Obsidian vault — open it as its own vault, not inside a
synced one, and you get graph view of the world's growth. Keep it in git and
`git log` becomes the history of reality.

## Watching

```
tesbota status   # where things stand right now
tesbota log      # the story so far; --new for only what you missed
```

`status` tells you which of the two suspends you are in — how long until the
adventurer wakes, or what the lore master is waiting on — and how many turns
have happened since you last looked. `log` marks unread turns with `*` and
moves the watermark when you read it.

## Web interface

```
nix-shell
(cd web && npm install)
TESBOTA_KEY=$(openssl rand -base64 18 | tr -d /+=) npm --prefix web run dev
```

Three panes: the **Explorer** story, the **Game master** machinery (every claim
with its verdict, redrafts, quote checks), and the **Lore master** — the pending
gap with a box to talk it through and a resolve button.

Reads come straight off `state/` in the Next process, so the UI hot-reloads while
you change it. Anything that needs the Agent SDK shells out to the CLI
(`tesbota say`, `tesbota resolve`, `tesbota step --json`), which also means those
commands work on their own from a terminal.

`TESBOTA_KEY` gates every route. Open `https://host/?k=<key>` once and it sets a
cookie; without it every path 404s. Expose it with
`cloudflared tunnel --url http://127.0.0.1:3000`.

## Time and vitals

Every action the game master narrates carries `minutes` (how long it takes in the
world) and `fatigue` (what it costs). Real elapsed time is in-world minutes
divided by `speed_factor` — 6000 during development, so a night's sleep is five
seconds and a day's march is under a minute. Set it to 1 and the world runs at
wall-clock speed.

100 fatigue is a full day of hard physical labour. The game master is told the
adventurer's condition before it drafts, so it warns them as they tire; if it
narrates an action that would take them past 100 anyway, the driver refuses the
draft and sends it back to be renarrated as a refusal plus what resting costs.
Rest is negative fatigue, roughly -12 an hour of sleep.

Health exists and is clamped the same way, but nothing spends it yet except
injuries the game master narrates.

## Calamity

The game master never rolls. It sets `risk` — how many faces of a hundred bring
calamity — and the driver rolls a d100 and records it on the turn. `risk` is 1
for anything ordinary, so a natural 100 can always go wrong however careful the
adventurer is; the game master raises it when they choose something reckless
(walking on past fatigue 99, wet rock in the dark, a river in spate). Clamped to
1–50.

On a hit the draft is sent back with the numbers and an instruction to renarrate
the same action going wrong — not to undo it. A calamity is exempt from the
fatigue ceiling, because it is something happening to them rather than something
they chose; its costs clamp instead of bouncing.

## Proposals

An intent is not narrated straight away. The game master prices it first — how
long it takes and what it costs — and the adventurer confirms before anything
happens.

The game master does not know the world's distances and must not invent them, so
it asks: it puts a question in `ask`, the driver routes it to a lore master in
query mode (read-only, forbidden to invent, allowed to answer "nothing records
that"), and the answer comes back before it prices anything. Up to three
questions per intent.

Trivial things — under 10 minutes and under 3 fatigue — skip the confirmation and
are narrated directly. Anything larger goes to the adventurer as a summary with
its cost, and it answers YES or NO. On a refusal its alternative becomes the new
intent; after three refusals the turn escalates to you.

Once confirmed, the agreed minutes and fatigue are stamped onto the draft by the
driver, so the narration cannot quietly re-price what was agreed.

## What can become true

`## Witnessed` is ground truth and covers a thing's properties, not just its
existence — if it is Witnessed that a stone is carved with two names, a claim
that it reads something else is FALSE, not FRICTION. Only `TRUE` claims are
written there. `FRICTION` claims land under `## Attested`, because a claim that
rubs against the record is disputed by definition and must not become ground
truth.

The one moving through this world is never an author. Its observations are
Witnessed; they do not belong in a book. A lore master that writes a document
attributed to it cannot close its gap until the document is removed or
reattributed, and `tesbota gaps` lists any that exist.

Delivery is idempotent — a turn stamps itself once delivered, so a re-run after a
crashed agent call cannot write a second, contradictory set of facts.

## Friction goes back to the game master

A `FRICTION` verdict no longer passes straight through. The claim and the text it
rubs against are sent back to the game master once, with the standing instruction
that contradiction is allowed here but must be deliberate: either renarrate so it
sits with the record, or keep it and make the discrepancy part of what happens —
the text is wrong, out of date, or its author lied.

It bounces exactly once. If the game master stands by the claim after being shown
what it contradicts, the contradiction is taken as intended and recorded under
`## Attested`.

## When an agent call fails

Agent calls retry once before giving up — the bundled Claude Code subprocess
occasionally exits badly mid-call, and a single retry recovers it.

If both attempts fail, the failure is reported rather than swallowed: the CLI and
both API routes return `{"error": ...}`, and the web page shows it as a red band
you can click to dismiss. The turn stays checkpointed wherever it got to, so
pressing step again resumes from there rather than repeating work.

The header shows `working…` while a call is in flight, so a turn that is waiting
for you is distinguishable from one that is running.

## $BOTA

Write `$BOTA` anywhere in canon to mark lore you have deliberately left unwritten —
a book whose later chapters nobody needs yet, a custom named but not described, a
gap in a lineage.

It is not the same as silence. Silence means the subject never came up, and
ordinary detail may fill it. `$BOTA` means somebody decided there would be
something here and has not written it yet, so:

- any claim resting on a `$BOTA` passage is UNRESOLVED, however small
- a quotation containing `$BOTA` is rejected outright, so it can never be read out
- the query lore master reports it by name rather than saying nothing is recorded
- `tesbota gaps` lists every one with its file and line — it is your backlog

The lore master stubs whatever it names: mentioning a place, person, item or book
that has no file creates that file in the same breath, frontmatter plus `$BOTA`
where the content will go. A wikilink pointing at nothing is a loose end; a stub is
a promise. If it does not know what contains a new place it writes `within: $BOTA`
rather than guessing, which brings the question back rather than settling it.

## Verdicts

- **TRUE** — the record affirms it: a Witnessed line or a godhead book says so.
- **WITHIN_BOUNDS** — nothing establishes it, but it is mundane or the only sensible
  reading of what is written. It stands. This is the ordinary verdict for the
  ordinary world and should be the common one.
- **FRICTION** — contradicts testimony. Goes back to the game master once to make
  the disagreement deliberate.
- **FALSE** — contradicts something Witnessed or a godhead book. Redraft.
- **UNRESOLVED** — the claim constrains the world. Escalates to you.

TRUE and WITHIN_BOUNDS both deliver and are recorded under `## Witnessed`; only
FRICTION and FALSE cost a redraft.

A lore session is archived onto the turn that triggered it. When the silence is
filled the conversation moves from the live chat into the turn record, along with
the gap that prompted it, and appears on that turn's slide as a collapsed
`lore session` — so the reasoning behind a ruling stays readable next to the
narration it produced.

## The die

A d400 is rolled on every action. `risk` scales how much of the bottom belongs to
calamity; fortune does not scale, because luck is not earned by being careless.

| roll | outcome |
|---|---|
| ≤ risk | greater calamity |
| ≤ 2 × risk | lesser calamity |
| 399 | lesser fortune |
| 400 | greater fortune |
| anything else | the action as narrated |

At the base risk of 1 that is a quarter of a percent each way. The game master
never rolls; it is told which way the die landed and asked to renarrate the same
action with that having happened — never to undo it.

## The adventurer's own body

Two commands, and the adventurer may run them itself:

```
tesbota stats       health, fatigue, hunger, and the skill sheet
tesbota inventory   what it is carrying
```

It is given `Bash` for this and nothing else — a permission callback denies every
command but those two, so it can consult itself without being able to read canon.
Command chaining is denied too, since the match is on the whole normalised line.
It starts in plain hard-wearing clothes and worn boots.

Hunger accrues with in-world time (about 4 an hour) rather than being narrated into
existence; the game master overrides it only when the adventurer actually eats, by
setting `hunger` on the draft.
