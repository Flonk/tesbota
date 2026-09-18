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
| **Lore master 1** | The narration, where, when | none | stateless |
| **Lore master 2** | The narration and its facts | read | stateless |
| **Lore master 3** | A silence in the world | read/write | per sitting |
| **Lore master 4** | Whatever you bring it | read/write | standing |
| **Narrator** | One finished turn, verbatim | none — it is an append log | none |

Lore master 3 has never heard of an adventurer. It thinks it is cataloguing a
library.

Lore master 4 is the same keeper of texts with the same writing manual, standing
rather than summoned: it is nobody's blocker, it has no gap to fill and no
`RESOLVED` to reach, and you can talk to it while a turn is running. It keeps its
thread and its session in `state/lore4.json` and never touches `campaign.json`, so
it cannot lose a step's work by writing over it — which is what makes talking
during a turn safe. What it writes lands in canon the moment it is written, so it
is told to write kinds and standing facts, never what is happening right now.

## What is true

There is no codex. `canon.db` is a pile of documents by authors who are biased,
mistaken, or lying, and they contradict each other constantly. That is the texture,
not a defect.

Ground truth is a book, and only a book. Two authors are not fallible: `the
godhead`, who states the world's laws, and `The Narrator`, who keeps the record of
what has actually happened. Every other author is
testimony, and may be contradicted freely.

The two are infallible about different things, and conflating them is how the
whole thing goes circular. The godhead settles what the world is *like*. The
narrator settles only that something *happened*, and licenses nothing beyond it:
a rat attacking in the chronicle does not establish that rats exist, and a proper
noun first appearing there is not thereby recorded. The chronicle is the world's
memory of a turn, never the document that permitted it — anything in it was
settled elsewhere or was never settled at all. Neither is the scene under
adjudication its own evidence: that a thing is named and acting in the narration
is the question, not the answer.

So lore master 1 returns four verdicts:

- **TRUE** — nothing contradicts it
- **FALSE** — contradicts a godhead book. The game master must revise.
- **UNRESOLVED** — the world is silent. Escalates to you.

Nothing becomes true by assertion, only by attribution. When you and lore master
3 fill a silence, you do not record a fact — you write a book, by a named author,
with a reason to be doubted.

## The narrator

There is a second godhead-class author and it is writing a book. It is not an agent.

After every turn that survives adjudication, the driver takes what the game master
actually said that turn — every `gm` phase, in order, joined into one paragraph — and
appends it as a passage of the book of whoever is walking — *The Life of Lene Bota*,
at `bota://books/the-life-of-lene-bota`. No call, no prompt, no model. The turn is
already on disk; setting it down is string work.

The book is one row in `entity`, one in `book` — author `The Narrator`, rarity
`unique` — and one `passage` row per turn, in turn order. Nothing any other layer
narrates or claims may contradict it, and that is what holds the observed world
together. It cuts one way only: the chronicle is unarguable about what happened
and is evidence for nothing about what is, so a lore master that can find nothing
for a claim but the chronicle has found nothing.

Every life gets its own book. The adventurer is named when a campaign starts — a
first name off a pool, the family name always `Bota` — and the title and the id
follow the name.

A life ends with `tesbota kill "<cause>"`. That only *records* the death, in
`state/death.json`, because whoever calls for one may be in the middle of a turn that
still has to be written; the driver carries it out at the top of its next pass. The
game master may call it itself when something the adventurer chose anyway kills them,
and the cause it gives finishes the sentence `who …`. The gear in the web header does
the same thing without a cause, and the book closes on *died of a mysterious cause* —
the godhead does not explain itself.

Carrying it out means: a last passage, `Here ends the life of Lene Bota, who …`; the
dead one's turns put away under `state/lives/`; whatever they carried gone with them;
and a new name, a fresh kit and a fresh book set walking in the same
world at the same hour. The closed book stays on the shelf; the world keeps
everything it has been told.

The book still holds instances and not kinds — *a figure challenged them at the gate*
and never *the town keeps gatekeepers* — but that line is no longer the narrator's to
draw. It is drawn upstream now, by a game master told to leave proper nouns alone and
to make one assertion per claim, and by a lore master that escalates anything
constraining the world rather than letting it through.

**The honest part.** With no agent between them, the passages are the game master's
own approved prose entering a book that lore master 1 then treats as fact. That is
self-certification and it is a real loss of separation. It was weighed and accepted:
the prose was already adjudicated claim by claim before delivery, so nothing enters
the book that lore master 1 did not already pass, and an agent whose whole job was a
person-swap and a link was not worth a call a turn.

Every name it sets down is still a deeplink, resolved deterministically:
`link_names()` matches the passage against `entity` — on a name, on a name with its
leading article stripped, and on the id with its hyphens as spaces — longest match
first, once per thing per passage, never inside an existing link and never inside a
quotation, since a quotation is the one assertion in this system that is checked with
`==`. Something the world has not named does not link. That is honest, and it is what
keeps lore master 3's backlog meaningful.

```
tesbota chronicle        read the book
tesbota chronicle -n 5   the last five passages
```

A deeplink pointing at a row nobody has written is an unresolved fact.

## Use

```
nix-shell
uv sync
uv run tesbota init
uv run tesbota step      # advance until something suspends
uv run tesbota status    # where things stand, how long until the adventurer wakes
uv run tesbota lore      # sit down with lore master 3 and end a silence
uv run tesbota talk "…"  # say one thing to lore master 4, any time
uv run tesbota chronicle # the narrator's book, the life so far
uv run tesbota holdings  # what everybody in the world is keeping
uv run tesbota map       # the world as mermaid; --json for the solved layout
uv run tesbota kill      # end this life; the next step sets a new one walking
```

Autoplay is `uv run tesbota play`, a loop that steps, honours the pause switch and
waits `--every` seconds in between. Without it — or the timer below — nothing turns
the world over; the web UI has no stepper of its own.

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

The narrator costs nothing at all. It is an append log, not a call — the one layer
whose output is permanent is the one layer that never talks to a model.

## Canon layout

The world is one SQLite file, `canon.db`. Every layer reads it the same way —
`sqlite3 -readonly canon.db "SELECT ..."`. Lore master 3 writes anywhere in it; the
driver appends the narrator's passages and applies what changed hands; nothing else
writes at all.

```
entity(id, kind, name, introduced, extent)      people | places | books | items
book(id, author, author_id, written, rarity)    author_id points at the person who wrote it
passage(book_id, ord, text)                     a book's text, one paragraph to a row
entity.about                                    a thing describing itself, no author
entity.made / entity.changed                    when the row was written and last touched
place(id, parent, type)                         every place sits inside one, and is one sort
                                                of thing: location, region, river,
                                                celestial-body, celestial-system or realm
way(src, dst, bearing, distance)                what leads where
item(id, type, weight, worth, owed_by, rarity, slot)
                                                weight in stone, for one of them;
                                                slot: where it is worn or held, or none
effect(item, stat, amount)                      what a thing does, a row per stat
aspect(id)                                      a mark anything can carry
tagged(entity, aspect, value)                   who carries it, and what of
ability(id, damage, advantage, cooldown, …)     what a body can do
grants(aspect, ability)                         what a mark hands out
holding(holder, item, qty, worn)                what a place, a person or the explorer keeps

writing(ref, entity, kind, section, body)       every passage, with its address
search(ref, entity, section, body)              fts5 over all of it
```

Containment is stored once, as a place's `parent`; what a place contains is that
column read backwards, so the two can never disagree. Nothing is duplicated and
nothing needs keeping in step.

Everything that can hold something holds it the same way. A `holding` row's `holder`
is an entity id — a shopkeeper, a mill, a room — or the reserved `the-explorer`, which
is deliberately not a foreign key, because the one moving through this world is never
an author and never a subject of the library. Lore master 3 stocks a place when it
writes the place: a mill has sacks in it before anybody walks in. The game master
moves goods with `move`, so a coin paid lands in somebody's till rather than leaving
the world, and it is shown what everything at the explorer's location keeps and told
that list is the truth on both sides of a trade.

```
tesbota holdings                what everybody is holding
tesbota holdings alheim-mill    just that one
tesbota inventory               the explorer's own, and the only one it may run
```

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

An address that names no row is the frontier. Nothing enumerates it. There was a
`gaps` command once and it was deleted: as the world filled with `$BOTA` the list
grew to be longer than the world it described, which is the permanent condition of
a place this young rather than a backlog anyone could work through. What is owed is
found the way everything here is found — by looking.

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
with its verdict and redrafts), and the **chat**, which is three
conversations under one bar: *lore master* (4) any time you like, *game master* to
steer the next turn, and *the silence* (lore master 3) which only opens when the
world is actually blocked on you.

The tab area beside the story holds the rest of the world. The **library** has its
own bar over places, people, books and items, one dense line to a row, with a search
box that filters by name as you type and runs the fts5 index on enter; `$BOTA`
rows are dashed rather than badged, and the whole panel drives from
the keyboard. Clicking any row — or any `bota://` address anywhere in the app, since
one renderer draws them all and a link to a row nobody has written looks like the
dangling link it is — opens a **dossier**: what is written about the thing, every
document that mentions it, what it keeps, and for a book, a reader you can page
through. The **map** is drawn from the solved layout, pans and zooms, and weights
every place by whether the explorer has walked it, whether something merely records
it, or whether it is only a name somebody wrote down.

One component per job, in `web/app/ui.jsx`. `Tag` is a verdict, `Pill` is a name,
`Mark` is an icon with its words, `Crumb` is a chain of places. Do not write a
second one.

The library's last tab is **data**: the machine looking at itself. `names` is the
pool a new adventurer is drawn from, marked where a name is already spoken for,
`common` is `tesbota/prompts/common.md` — how to query the world, the schema and the
deeplinks, which every agent but the explorer includes — and after them comes one tab
per system prompt — explorer, game master, propose, lore 1,
queries, lore 3, lore 4 — each shown exactly as that agent receives it, deeplinks
and current name filled in. It is a lookup and nothing else; nothing there is
editable. `tesbota data` prints the same thing, `--json` for the whole payload.

Reads come straight off `state/` and `canon.db` in the Next process, so the UI
hot-reloads while you change it. Anything that needs the Agent SDK shells out to the
CLI (`tesbota say`, `tesbota talk`, `tesbota resolve`, `tesbota step --json`), which also means those
commands work on their own from a terminal. The map does the same for
`tesbota map --json`, because solving a layout is Python.

The gear opens settings: pause, which stops the driver stepping at all until it is
let go (`tesbota pause on|off`), a game-speed dial from real time to 20000 minutes a
minute (`tesbota speed <n>`; the prototype runs at 6000, the target is 10), and
killing the adventurer. The step button is gone from the tab bar.

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

The game master never rolls. The driver rolls a d400 on every delivered action and
records it on the turn: 1 is a greater calamity, 2 a lesser one, 399 a lesser
fortune, 400 a greater one. Nobody dials it — the odds are the same for a careful
step and a reckless one, and what the adventurer chooses shows up in the skill check
instead.

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
something else is FALSE. What a thing says, reads, looks like or is
made of is as fixed as the fact that it is there.

Claims are no longer written to canon by the driver at all. They are the unit lore
master 1 rules on, they are kept on the turn record with their verdicts, and what
actually happened is the narrator's to keep.

What survives in `claim` is narrower still. A thing's own description lives on the
thing, in `entity.about`, because nobody is asserting it — a village being a village
needs no author. What a place contains and opens onto is `place.parent` and `way`, and only
the graph. That leaves `claim` for the one thing neither covers: testimony no
document holds, where somebody said a thing and there is no book to cite. There are
currently none, and that is the honest state of a world whose authors have all
written their accounts down.

The redundancy this replaced is worth recording. Every claim used to restate, in
flatter prose, something a book already said — the hearth roll's third passage was
paraphrased by three separate claims. They existed because books did not deeplink
their own subjects, so a person could not be found from the book about them, and the
claim was the only index. The fix was to link the passages, not to keep the copy:
`canon.link_writing()` runs the same deterministic linker the narrator uses over
every passage, claim and description, and `tesbota resolve` runs it after each lore
session. With the links in, the backlink is the index and the copy is just drift
waiting to happen.

The one moving through this world is never an author. Its observations are the
narrator's, not its own, and they do not belong in a book of its writing. A lore
master that attributes a document to it cannot close its gap until the document is
removed or reattributed; the sitting refuses to resolve while one stands.

Delivery is idempotent — a turn stamps itself once delivered, so a re-run after a
crashed agent call cannot write a second, contradictory set of facts.

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
- it is the backlog, and it is found the way everything here is found:
  `SELECT ref, body FROM writing WHERE body LIKE '%$BOTA%'`

The lore master stubs whatever it names: mentioning a place, person, item or book
that has no row inserts that row in the same breath. A deeplink pointing at
nothing is a loose end; a bare row with nothing written against it is a promise,
If it does not know what contains a new place it
leaves the place unwritten rather than guessing a parent, which brings the question back
rather than settling it.

The game master no longer writes claims. It narrates; lore master 1 reads the
narration with no access to canon at all and regresses it to bare world-facts — a
house stands here, houses exist, something with feet smaller than a man's exists,
fog exists — and lore master 2 takes the narration and those facts and rules on each.
Splitting the reading from the ruling keeps the question general: the reader cannot
see what canon already holds, so it cannot quietly frame a fact to fit.

## Verdicts

- **TRUE** — the record affirms it: a godhead book says so, or it implies nothing
  beyond the moment. Never the narrator's book, and never the narration being ruled on.
- **WITHIN_BOUNDS** — nothing establishes it, but it follows from what does: ordinary
  furniture, or the only sensible continuation of the record. It stands, and lore
  master 1 settles it rather than escalating. The common verdict.
- **FALSE** — the record will not bear it. Redraft. Godhead books and the narrator's
  are never arguable; against any other author it is lore master 1's call, weighing
  whether that document is authoritative on the point.
- **UNRESOLVED** — the claim commits the world to something it does not have.
  Escalates to you.

TRUE and WITHIN_BOUNDS both deliver; only FALSE costs a redraft. What
is recorded is the narrator's passage, written once the whole turn is through.

**A fight is fought against things the world keeps.** Every body in one carries an
id, and that id has to be a row. `body(id, health, damage, dc, bonus, defense, skill)`
is what a thing brings, written against the thing itself, so a Rat is the same Rat
every time it comes out of the grass; what it wears adds its own defense on top, the
way the explorer's does. The game master may write any of those over for one fight — a
half-starved rat, a guard already bloodied — and what it writes is never kept.

A body the game master names that has no row goes to lore master 2, which can read
canon and so can tell the two cases apart. Same kind under another name binds to what
is recorded: *a mill rat* is `rat`, keeps that name in the scene, and fights with the
Rat's numbers. A different kind binds to nothing — an orc is not an elf and is not the
nearest thing the world happens to have — so it comes back UNRESOLVED and the fight
stops until somebody writes the creature. Lore staying silent about a stranger is
treated as a refusal, not as consent.

**A fight is adjudicated once, at its declaration.** The game master declares who
is on the ground, and the `muster` step puts that declaration and the whole roster
— every body, its health, its damage, what it can do — through lore masters 1 and
2. FALSE sends the fight back to be declared again; UNRESOLVED holds the world
until somebody writes the missing document. Past that the fight is the game
master's alone: the blows are rolled by the driver and narrated by the game
master, and no lore master sees any of it. A blow is a particular — one body doing
one thing at one moment — and particulars were never theirs to rule on. Checking
them turn by turn asked the same questions thirty times and answered them out of
the scene itself.

A lore session is archived onto the turn that triggered it. When the silence is
filled the conversation moves from the live chat into the turn record, along with
the gap that prompted it, and appears on that turn's slide as a collapsed
`lore session` — so the reasoning behind a ruling stays readable next to the
narration it produced.

## The die

Every delivered action is rolled against a d400.

| roll | outcome |
|---|---|
| 1 | greater calamity |
| 2 | lesser calamity |
| 399 | lesser fortune |
| 400 | greater fortune |
| anything else | the action as narrated |

A quarter of a percent each way. The game master
never rolls; it is told which way the die landed and asked to renarrate the same
action with that having happened — never to undo it.

## The adventurer's own body

Two commands, and the adventurer may run them itself:

```
tesbota stats       health, fatigue, hunger, and the skill sheet
tesbota inventory   what it is carrying
tesbota quests      the journal: what it has taken on and what it knows
```

It is given `Bash` for this and nothing else — a permission callback denies every
command but those two, so it can consult itself without being able to read canon.
Command chaining is denied too, since the match is on the whole normalised line.
It starts in plain hard-wearing clothes and worn boots, carrying nothing else.

Hunger accrues with in-world time (about 4 an hour) rather than being narrated into
existence; the game master overrides it only when the adventurer actually eats, by
setting `hunger` on the draft.

A fight can kill them, and so can a river, a fall or cold. The game master is told to
warn before the danger and then let the dice mean what they say — never death by
fiat, and never a reprieve by fiat either. When one lands it runs
`tesbota kill "<cause>"`, and the cause becomes the last line of their book.

## Checks

The adventurer has six ability scores and a proficiency bonus. A skill's bonus is
its ability modifier plus proficiency if trained; the sheet starts trained in
perception and survival, with otherwise unremarkable scores.

Most actions get one. The game master sets
`"check": {"skill": "athletics", "dc": 12}` on its reply — 10 is something most
people manage, 15 takes doing, 20 is a long shot — and the driver rolls a d20, adds
the bonus and compares. A pass delivers. A failure sends the draft back with the
numbers and an instruction to renarrate the attempt not working, without undoing the
attempt itself. The game master never rolls, and it is told to roll for anything with
a way to go wrong rather than decide it; only what cannot fail goes unrolled.

A body at its limit rolls worse: at 100 fatigue or 100 hunger the check is rolled
twice and the lower kept, and at both it is rolled three times. Nothing else scales a
check — the old `risk` dial the game master set on every action is gone, and the d400
now reads calamity at 1 and 2 the same way it reads fortune at 399 and 400.

Checks and the d400 are resolved in the same pass, so an action needs at most one
redraft even when both land.

Everything anybody carries is an entity of kind `items` with an `item` row saying
what it is — `type`, and the columns that type asks for. A holding is a holder, an
item id, a count and whether it is worn, so the thing in a pack and the
thing in the library are the same thing, and naming one the world lacks writes it
down on the spot.

The web header keeps health, fatigue and hunger as bars; clicking them opens the
character sheet — condition, ability scores, all eighteen skills with their
bonuses, and the itemised inventory.

## Maps

Places carry `way` rows — a target, a bearing and a rough distance each.
Distances may be vague, because most of this world has never been measured; a
number belongs there only where somebody in the world actually measured it, and
the attested claim says who.

That plus `within` is already a graph, so the map is a recursive query rather
than a walk over rows, and `tesbota map` renders it as mermaid — containment as
nested subgraphs, exits as labelled edges, unwritten places dashed.

**The map is a projection of the graph, not a stored thing.** It is solved fresh
from `within` and `exits` every time, and there are two layers to what it may know.

*Derived, never stored.* `bearing_degrees()` turns a bearing into degrees clockwise
from north, and `distance_band()` turns a distance into a low and a high in metres
— wide on purpose, because "a short walk" is 200 to 1200 metres and pretending
otherwise is a lie. Both return nothing at all for the vague cases rather than a
guess, and most of this world's roads are a vague case. They live in
`tesbota/travel.py`, which already owns leagues and journey timing.

*Established, stored.* A place may carry an `extent` — GeoJSON on `entity` — and
only lore master 3 writes one, only where a document in the world measured the
thing. The Council surveys a road; a plate carries a boundary. A place with no
extent is not a defect and is never given one to make the map look better, because
coordinates would mean inventing precision nobody established.

`tesbota/mapping.py` solves the two into a layout — seeded, so the same world always
draws the same map — with an extent pinning a place absolutely, a bearing fixing an
angle, a distance band fixing a range, and containment placing whatever has nothing
else. A place with no bearing and no distance to anything is `floating`: it is
reported as floating and given no position at all rather than a made-up one, and the
map lists it in a gutter instead of scattering it into the middle. `tesbota map`
still prints mermaid; `tesbota map --json` prints the solved layout.

The renderer draws each containment group in its own frame and compresses distances
within a group before drawing them, because this world runs from a hundred metres to
thirty kilometres and one linear frame makes a village a dot. Bearings and ordering
survive that; the metres do not, which is why every road keeps the distance somebody
actually recorded on its label and says "nobody has measured this" when nobody has.

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

The game master is shown what the adventurer carries on every turn, and what
everything else at the place carries, and is told those lists are the truth — nobody
hands over, spends or uses what is not on one, and a coin is never invented into
anybody's hand.

Everything that changes hands is one `transactions` ledger, applied by the driver:
`{from, to, name, qty}`. `the-godhead` on either side is the world itself —
bread eaten goes to it, a coin found in the mud comes from it.

A holder may move something they do not have, which leaves them short by it. That is
how a promise is written down: Greta Marsch owing a bed for finding her child moves a
voucher for it into the adventurer's pack and goes to `-1` herself, and the game
master reading her holdings next time sees `(owes 1)` — the debt is the proof the
voucher is good. Redeeming it is another move, and her row clears when she settles.
The prompt governs when a short is legitimate: only what the holder can actually
underwrite. Quantities stack case-insensitively, a row at exactly zero is deleted,
and a transfer to the world clips at zero rather than going negative, because
nothing can be owed to the world.

## Quests

The game master keeps the log. `quest_open` takes an id, title, detail and giver;
`quest_close` takes an id and an outcome of `done`, `failed` or `abandoned`. It is
shown the open ones every turn, so it will not re-open what already stands, and it
is told to open one only when the adventurer has actually agreed — a thing somebody
mentions is not a quest, a thing they said they would do is. One entry per errand.

Re-opening an existing id is ignored, closing an already-closed or unknown quest is
a no-op, and the turn that opened or closed each one is recorded.

A quest's `detail` is the adventurer's own journal line — it reads it with
`tesbota quests`, and the game master rewrites it with `quest_update` as things are
learned, the way a journal entry changes under you. The script is never in it.

When a quest opens, a questmaster — Opus, one stateless read-only call — writes it a
`script`: twists, branches, and $BOTA marks filled in with whatever it likes. None of
it is canon. The game master is shown it with the quest and plays toward it; the
explorer never sees it, and every hard thing in it has to survive lore master 1 to
become true, which is where the ideas meet the world.

`tesbota quests` prints ongoing and finished. In the web UI the active quest sits
under the location breadcrumb, and the full log is the `quests` tab under the
adventurer's own name, carrying a count of what is still open.

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
