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
