/**
 * The machine, and the whole of it.
 *
 * Every state the world can be in and every edge between them is declared here
 * and nowhere else. A step does not decide where it goes by assignment — it
 * returns the name of an edge, and the driver looks that edge up in this table.
 * An edge that is not written here cannot be taken.
 *
 * This file is also what the dev tab draws. There is no second copy of the
 * diagram: `/api/machine` serves this table, the page renders whatever it is
 * given, and a state added here appears there without anybody drawing it.
 */

import type { AgentId } from "./agents.ts";

/**
 * Who does the work in a state. Every agent is one of these, and so are the two
 * that are not agents at all: `cli` for what the driver does on its own, and
 * `human` for what waits on a person.
 */
export type Runs = AgentId | "cli" | "human";

/**
 * The states, named once. Everything else is derived from this, so adding one
 * here makes the table below incomplete until it is written, which is the point.
 */
export const STATE_NAMES = [
  "explorer", "answer", "propose", "gm", "muster", "swing", "fight", "blows",
  "lore1", "lore2", "deliver", "narrate", "arbiter", "lore3", "clock", "done",
] as const;

export type StateName = (typeof STATE_NAMES)[number];

export type Edge = {
  /** the state this edge leads to */
  readonly to: StateName;
  /** the name a step returns to take it, unique within its state */
  readonly on: string;
  /** what it means, in the world's terms — the diagram's edge label */
  readonly when: string;
};

export type State = {
  /** what happens while the world is here */
  readonly does: string;
  /** who does the work here, which is what the diagram colours by */
  readonly runs: Runs;
  /**
   * Which agents this state asks, in the order it asks them. This is the honest
   * count of what a turn costs, and it is here because a state named after one
   * agent quietly calling a second is exactly the kind of thing a table like this
   * exists to stop.
   */
  readonly agents: readonly AgentId[];
  /**
   * Who advances it. The loop runs most of them; a `held` state waits on the
   * clock or on a person, and the driver will not step it on its own.
   */
  readonly driven: "loop" | "held";
  readonly edges: readonly Edge[];
};

export const STATES = {
  explorer: {
    does: "the adventurer decides what to do with the turn",
    runs: "explorer",
    agents: ["explorer"],
    driven: "loop",
    edges: [
      { to: "propose", on: "acts", when: "commits to an action" },
      { to: "answer", on: "looks", when: "asks a question first" },
      { to: "narrate", on: "quiet", when: "they are done — set the turn down" },
      { to: "explorer", on: "again", when: "said nothing usable" },
      { to: "arbiter", on: "stuck", when: "could not be reached" },
    ],
  },

  answer: {
    does: "the game master answers without the world moving",
    runs: "gm",
    agents: ["answer"],
    driven: "loop",
    edges: [{ to: "lore1", on: "answered", when: "the answer needs checking" }],
  },

  propose: {
    does: "the game master prices the action — how long, how tiring, how it could go",
    runs: "propose",
    agents: ["propose", "queries"],
    driven: "loop",
    edges: [
      { to: "gm", on: "priced", when: "the cost is settled" },
      { to: "propose", on: "again", when: "the proposal did not parse" },
    ],
  },

  gm: {
    does: "the game master narrates what happens",
    runs: "gm",
    agents: ["gm"],
    driven: "loop",
    edges: [
      { to: "lore1", on: "narrated", when: "an ordinary turn" },
      { to: "muster", on: "declares", when: "it declared a fight" },
    ],
  },

  muster: {
    does: "the only lore check a fight gets: the declaration and every body in it",
    runs: "lore2",
    agents: ["lore1", "lore2"],
    driven: "loop",
    edges: [
      { to: "swing", on: "mustered", when: "the roster stands" },
      { to: "gm", on: "rejected", when: "the record will not bear it" },
      { to: "arbiter", on: "unwritten", when: "it named something nobody has written" },
    ],
  },

  swing: {
    does: "the adventurer is asked what to do with this round of theirs",
    runs: "explorer",
    agents: ["explorer"],
    driven: "loop",
    edges: [{ to: "fight", on: "chose", when: "they said what they are doing" }],
  },

  fight: {
    does: "one body takes its turn — the driver rolls, nobody argues",
    runs: "cli",
    agents: [],
    driven: "loop",
    edges: [
      { to: "swing", on: "theirs", when: "it is the adventurer's turn again" },
      { to: "fight", on: "next", when: "the next body acts" },
      { to: "blows", on: "over", when: "somebody is down or has run" },
    ],
  },

  blows: {
    does: "the game master puts words on the exchange that was already rolled",
    runs: "gm",
    agents: ["gm"],
    driven: "loop",
    edges: [{ to: "deliver", on: "written", when: "the fight was checked at its muster" }],
  },

  lore1: {
    does: "reads the world out of the narration — it cannot see canon, only the words",
    runs: "lore1",
    agents: ["lore1"],
    driven: "loop",
    edges: [{ to: "lore2", on: "read", when: "the facts are out of it and want ruling on" }],
  },

  lore2: {
    does: "rules on every claim against the record, and it is the only layer that reads canon",
    runs: "lore2",
    agents: ["lore2"],
    driven: "loop",
    edges: [
      { to: "deliver", on: "stands", when: "nothing contradicts the record" },
      { to: "gm", on: "redraft", when: "a claim is FALSE, or the dice went against them" },
      { to: "answer", on: "reanswer", when: "the answer needs redrafting" },
      { to: "arbiter", on: "unwritten", when: "the world is silent and cannot go on" },
    ],
  },

  deliver: {
    does: "the turn is applied — vitals, inventory, quests, the clock, the fight's wounds",
    runs: "cli",
    agents: ["questmaster"],
    driven: "loop",
    edges: [{ to: "explorer", on: "spent", when: "the turn is applied — they get the rest of it" }],
  },

  narrate: {
    does: "the narrator sets the turn down as a passage of the life",
    runs: "cli",
    agents: [],
    driven: "loop",
    edges: [{ to: "done", on: "written", when: "it is in the book" }],
  },

  // The silence is two states, not one. A single `lore3` could not say whether
  // the world was waiting on a person or whether the lore master was mid-answer,
  // so anybody watching from outside saw nothing happen for as long as it took.
  arbiter: {
    does: "the world is silent and holds until you settle what is missing",
    runs: "human",
    agents: [],
    driven: "held",
    edges: [{ to: "lore3", on: "said", when: "you wrote something back" }],
  },

  lore3: {
    does: "the lore master answers you, and writes the world where it was silent",
    runs: "lore3",
    agents: ["lore3"],
    driven: "held",
    edges: [
      { to: "arbiter", on: "answered", when: "it wrote back and the silence stands" },
      { to: "gm", on: "ruled", when: "canon was written — narrate it again" },
      { to: "answer", on: "ruled_answer", when: "canon was written for a question" },
      { to: "explorer", on: "ruled_explorer", when: "canon was written — ask the adventurer again" },
    ],
  },

  clock: {
    does: "they are walking, and real time has to pass before they arrive",
    runs: "cli",
    agents: [],
    driven: "held",
    edges: [
      { to: "gm", on: "arrived", when: "they reached it, or the road was cut short" },
      { to: "explorer", on: "woken", when: "the time simply passed" },
    ],
  },

  done: {
    does: "the turn is closed and the next one begins",
    runs: "cli",
    agents: [],
    driven: "held",
    edges: [
      { to: "explorer", on: "next", when: "another turn" },
      { to: "clock", on: "walks", when: "the turn took time or put them on the road" },
    ],
  },
} as const satisfies Record<StateName, State>;

export type EdgeOn<S extends StateName> = (typeof STATES)[S]["edges"][number]["on"];

export type LoopState = {
  [S in StateName]: (typeof STATES)[S]["driven"] extends "loop" ? S : never;
}[StateName];

/** Where a step in this state is allowed to go, by the edge name it returns. */
export function edgeFrom<S extends StateName>(state: S, on: EdgeOn<S>): Edge {
  const edges: readonly Edge[] = STATES[state].edges;
  const found = edges.find((e) => e.on === on);
  if (!found) {
    const legal = edges.map((e) => e.on).join(", ");
    throw new Error(`no edge \`${on}\` out of \`${state}\` — this state goes: ${legal}`);
  }
  return found;
}

/** The whole table as plain data, which is what the dev tab draws. */
export function describe() {
  return {
    states: STATE_NAMES.map((name) => ({
      name,
      does: STATES[name].does,
      runs: STATES[name].runs,
      agents: STATES[name].agents,
      driven: STATES[name].driven,
      calls: STATES[name].agents.length,
    })),
    edges: STATE_NAMES.flatMap((from) =>
      STATES[from].edges.map((e) => ({
        id: `${from}:${e.on}`,
        from,
        to: e.to,
        on: e.on,
        when: e.when,
      }))
    ),
  };
}

/** Every state is reachable and every edge lands somewhere that exists. */
export function audit(): string[] {
  const wrong: string[] = [];
  const reached = new Set<string>(["explorer"]);
  for (const from of STATE_NAMES) {
    const seen = new Set<string>();
    for (const edge of STATES[from].edges) {
      if (!(edge.to in STATES)) wrong.push(`${from}:${edge.on} goes to unknown \`${edge.to}\``);
      if (seen.has(edge.on)) wrong.push(`${from} has two edges named \`${edge.on}\``);
      seen.add(edge.on);
      reached.add(edge.to);
    }
    if (!STATES[from].edges.length) wrong.push(`${from} has no way out`);
  }
  for (const name of STATE_NAMES) {
    if (!reached.has(name)) wrong.push(`${name} is unreachable`);
  }
  // A transition is watched from outside as a pair of states, so no two edges may
  // share one — otherwise the diagram cannot say which of them just lit up.
  const pairs = new Set<string>();
  for (const from of STATE_NAMES) {
    for (const edge of STATES[from].edges) {
      const pair = `${from}->${edge.to}`;
      if (pairs.has(pair)) wrong.push(`${pair} is described by two edges`);
      pairs.add(pair);
    }
  }
  return wrong;
}

if (process.argv[1]?.endsWith("machine.ts")) {
  const wrong = audit();
  const { states, edges } = describe();
  console.log(`${states.length} states, ${edges.length} edges`);
  for (const e of edges) console.log(`  ${e.from} --${e.on}--> ${e.to}   (${e.when})`);
  if (wrong.length) {
    console.error("\nwrong:");
    for (const w of wrong) console.error("  " + w);
    process.exit(1);
  }
  console.log("\naudit clean");
}
