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
| **Narrator** | One finished turn | read, writes its own book | stateless |

The Explorer cannot see the world at all, so the game master must reproduce book
text **verbatim** — and the driver diffs every quotation against the passage it
cites before the Explorer sees it. It is the only assertion in the system that
can be checked with `==`.

Lore master 3 has never heard of an adventurer. It thinks it is cataloguing a
library.

## What is true

There is no codex. `canon.db` is a pile of documents by authors who are biased,
mistaken, or lying, and they contradict each other constantly. That is the texture,
not a defect.

Ground truth is a book, and only a book. Two authors are not fallible: `the
godhead`, who states the world's laws, and `The Narrator`, who keeps the record of
what has actually happened. Everything else — every claim, every other author — is
testimony, and may be contradicted freely.

So lore master 1 returns four verdicts:

- **TRUE** — nothing contradicts it
- **FRICTION** — contradicts a document but not the record. Allowed. Interesting.
- **FALSE** — contradicts a godhead book. The game master must revise.
- **UNRESOLVED** — the world is silent. Escalates to you.

Nothing becomes true by assertion, only by attribution. When you and lore master
3 fill a silence, you do not record a fact — you write a book, by a named author,
with a reason to be doubted.

## The narrator

There is a second godhead-class entity, and it is writing a book.

After every turn that survives adjudication, the narrator is handed that turn — what
the explorer did, what it looked at, what it said, what it was told — and sets down a
passage of `bota://books/the-life-of-explorer-1`, *The Life of Explorer #1*. It sees
one finished turn and the last few passages it wrote, and nothing else. It has never
heard of a die.

Because it is godhead-class its book is law, and nothing any other layer narrates or
claims may contradict it. That is what holds the observed world together, and it is
why there is no longer a special kind of claim doing the same job badly.

It writes instances, never kinds. *A figure challenged them at the gate* is the
narrator's; *the town keeps gatekeepers who challenge travellers* is not, and writing
it would settle by accident something the world has not decided. That is the same
line lore master 1 draws when it escalates, and it is what keeps the narrator from
quietly becoming the codex this world does not have.

Every name it sets down is a deeplink, and anything it links that has no row gets a
bare one in the same breath — so the chronicle is also what keeps extending lore
master 3's backlog.

```
tesbota chronicle        read the book
tesbota chronicle -n 5   the last five passages
```

It writes to `passage` and `entity` and nothing else. The permission callback denies
the rest, so the chronicler cannot rewrite the library it is shelved in.

A deeplink pointing at a row nobody has written is an unresolved fact. `tesbota
gaps` lists the frontier.

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
uv run tesbota chronicle # the narrator's book, the life so far
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

The narrator is one more stateless call at the end of each turn, reading three
passages and one turn. It is the cheapest layer in the system and the only one whose
output is permanent.

## Canon layout

The world is one SQLite file, `canon.db`. Every layer reads it the same way —
`sqlite3 -readonly canon.db "SELECT ..."`. Lore master 3 writes anywhere in it; the
narrator writes only passages and bare rows; nothing else writes at all.

```
entity(id, kind, name, introduced)              people | places | books | items
book(id, author, author_id, written, rarity)    author_id points at the person who wrote it
passage(book_id, ord, text)                     a book's text, one paragraph to a row
claim(id, entity_id, section, turn_id, text)    attested | map — all of it testimony
edge(src, rel, dst, bearing, distance)          within | exits

writing(ref, entity, kind, section, body)       every passage and claim, with its address
search(ref, entity, section, body)              fts5 over all of it
unwritten(id, kind, name)                       named by somebody, written by nobody
```

Containment is stored once, as a `within` edge; what a place contains is that
edge read backwards, so the two can never disagree. Nothing is duplicated and
nothing needs keeping in step.

### Deeplinks

Everything has an address, and the writing is full of them:

```
bota://places/alheim-mill
bota://books/petra-volls-route-notes#p2     the second passage of that book
bota://people/petra-voll#c14                claim 14
```

In prose an address is wrapped so the sentence still reads —
`[the mill](bota://places/alheim-mill)` — and the words in brackets are the ones
the author chose. Every layer knows the format, so a book that names a person is
a link you can follow both ways: what they wrote, what is written about them,
everywhere they are mentioned.

```sql
SELECT ref, body FROM writing WHERE body LIKE '%/petra-voll%';
SELECT id FROM book WHERE author_id = 'petra-voll';
SELECT ref, snippet(search, 3, '[', ']', '…', 12) FROM search
  WHERE search MATCH 'mill NEAR/5 boy' ORDER BY rank;
```

An address that names no row is the frontier — `tesbota gaps` lists them.

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

A narrator's passage covers a thing's properties, not just its existence — if the
narrator has set down that a stone is carved with two names, a claim that it reads
something else is FALSE, not FRICTION. What a thing says, reads, looks like or is
made of is as fixed as the fact that it is there.

Claims are no longer written to canon by the driver at all. They are the unit lore
master 1 rules on, they are kept on the turn record with their verdicts, and what
actually happened is the narrator's to keep. `claim` belongs to lore master 3 now —
`attested` testimony and `map` — and every row in it is somebody's word.

The one moving through this world is never an author. Its observations are the
narrator's, not its own, and they do not belong in a book of its writing. A lore
master that attributes a document to it cannot close its gap until the document is
removed or reattributed, and `tesbota gaps` lists any that exist.

Delivery is idempotent — a turn stamps itself once delivered, so a re-run after a
crashed agent call cannot write a second, contradictory set of facts.

## Friction goes back to the game master

A `FRICTION` verdict no longer passes straight through. The claim and the text it
rubs against are sent back to the game master once, with the standing instruction
that contradiction is allowed here but must be deliberate: either renarrate so it
sits with the record, or keep it and make the discrepancy part of what happens —
the text is wrong, out of date, or its author lied.

It bounces exactly once. If the game master stands by the claim after being shown
what it contradicts, the contradiction is taken as intended and recorded as
`attested`.

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
- `tesbota gaps` lists every one with its address — it is your backlog

The lore master stubs whatever it names: mentioning a place, person, item or book
that has no row inserts that row in the same breath. A deeplink pointing at
nothing is a loose end; a bare row with nothing written against it is a promise,
and `unwritten` lists every one. If it does not know what contains a new place it
writes no `within` edge rather than guessing, which brings the question back
rather than settling it.

## Verdicts

- **TRUE** — the record affirms it: a godhead book or the narrator's says so.
- **WITHIN_BOUNDS** — nothing establishes it, but it is mundane or the only sensible
  reading of what is written. It stands. This is the ordinary verdict for the
  ordinary world and should be the common one.
- **FRICTION** — contradicts testimony, but nothing godhead-class. Goes back to the
  game master once to make the disagreement deliberate.
- **FALSE** — contradicts a godhead book, the narrator's record included. Redraft.
- **UNRESOLVED** — the claim constrains the world. Escalates to you.

TRUE and WITHIN_BOUNDS both deliver; only FRICTION and FALSE cost a redraft. What
is recorded is the narrator's passage, written once the whole turn is through.

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

## Checks

The adventurer has six ability scores and a proficiency bonus. A skill's bonus is
its ability modifier plus proficiency if trained; the sheet starts trained in
perception and survival, with otherwise unremarkable scores.

When an action could plainly fail, the game master sets
`"check": {"skill": "athletics", "dc": 12}` on its reply — 10 is something most
people manage, 15 takes doing, 20 is a long shot — and the driver rolls a d20,
adds the bonus and compares. A pass delivers. A failure sends the draft back with
the numbers and an instruction to renarrate the attempt not working, without
undoing the attempt itself. The game master never rolls, and most actions need no
check.

Checks and the d400 are resolved in the same pass, so an action needs at most one
redraft even when both land.

Inventory entries are objects — `name`, `qty`, `note`, and `worn` — so the
adventurer's clothes sit apart from what it is carrying, and quantities and
condition are recorded rather than baked into a sentence. String entries from
older campaigns are converted on load.

The web header keeps health, fatigue and hunger as bars; clicking them opens the
character sheet — condition, ability scores, all eighteen skills with their
bonuses, and the itemised inventory.

## Maps

Places carry `exits` edges — a target, a bearing and a rough distance each.
Distances may be vague, because most of this world has never been measured; a
number belongs there only where somebody in the world actually measured it, and
the attested claim says who.

That plus `within` is already a graph, so the map is a recursive query rather
than a walk over rows, and `tesbota map` renders it as mermaid — containment as
nested subgraphs, exits as labelled edges, unwritten places dashed.

Geometry is deliberately absent. Nothing here knows where anything is in metres,
and coordinates would mean inventing precision nobody established. If a surveyed
place ever earns real geometry, that is a property of the fiction — the Council
measures roads — rather than something every place needs.

## Looking before acting

The adventurer may look harder at what is already in front of it before committing
to an action. It begins a reply with `LOOK:` and the game master answers what can
be perceived from where it stands — no time passes, no fatigue, no die roll, and
nothing is done.

The answer still goes through the lore master like any narration, so a look cannot
smuggle in world facts the adjudicator never saw. Two per turn; a third falls
through and is treated as an intent.

## Steering

You can queue a note for the game master from the current turn's slide. It reaches
the game master on its next turn — both when pricing the intent and when narrating
the outcome — framed as direction rather than as an event, with the standing rule
that nobody in the story says it and the adventurer never learns of it.

A note is consumed once: `step_propose` moves it from the campaign onto the turn it
steers, where it stays visible on that slide afterwards. `tesbota note "..."` does
the same from a terminal, and an empty string clears a queued one.

## Talking and trading

`SAY:` opens an exchange — the game master answers in the other person's own voice
and nothing else happens. Up to four before acting, against two for `LOOK:`.
Talking settles nothing: a price named is not a price paid.

The game master is shown what the adventurer carries on every turn and is told the
list is the truth — they cannot hand over, spend or use what is not on it, and a
coin is never invented into their hand. When something actually changes hands it
records `gain` (name, qty, note) and `lose` (name, qty), applied by the driver.
Quantities stack case-insensitively, losing more than is held empties the entry
rather than going negative, and losing something unheld is a no-op.

## The notebook

The adventurer carries a notebook and can write to it itself:

```
tesbota notebook          read it back
tesbota notebook "…"      write a line
```

Lines are capped at 120 characters and the last 24 are kept, so it stays a list of
short reminders rather than a diary. It appears in the character sheet alongside
condition, abilities and inventory.

The permission callback allows `tesbota notebook` with free text, so it first
rejects any command containing shell metacharacters — `; | & $ backtick > <` or a
newline — before matching the verb. Everything else the adventurer might type is
still denied.

## Quests

The game master keeps the log. `quest_open` takes an id, title, detail and giver;
`quest_close` takes an id and an outcome of `done`, `failed` or `abandoned`. It is
shown the open ones every turn, so it will not re-open what already stands, and it
is told to open one only when the adventurer has actually agreed — a thing somebody
mentions is not a quest, a thing they said they would do is. One entry per errand.

Re-opening an existing id is ignored, closing an already-closed or unknown quest is
a no-op, and the turn that opened or closed each one is recorded.

`tesbota quests` prints ongoing and finished. In the web UI the active quest sits
under the location breadcrumb, and a `quests` button opens the full log with a count
of what is still open.

## The world clock

The world runs on a 24-hour clock of 60-minute hours, starting at **4E202 13:04**.
Every delivered action advances it by its `minutes`, days roll over at 1440, and the
turn records the time it happened at.

`tesbota time` prints it. The game master is told the time on every prompt — context,
proposal and narration — so dusk, closing time and a shop being shut are its to
notice. Quests record the world time they were opened and closed at, alongside the
turn.

The calendar beyond that is undecided: days count up, but nothing says how many make
a year, so the year does not yet advance.

The calendar is law, not convention: `bota://books/the-ordering-of-the-year` is a
godhead book, so the lore master treats it as ground truth and no in-world text may
contradict it. Seven days a week, four weeks a month, eight months a year — 28 days
per month, 224 per year, every month beginning on a Firstday.
