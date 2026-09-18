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

export type Kind = "agent" | "roll" | "book" | "wait" | "end";

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
  /** what kind of work it is, which is what the diagram colours by */
  readonly kind: Kind;
  /** how many agent calls it costs to leave, for the cost readout */
  readonly calls: number;
  readonly edges: readonly Edge[];
};

export const STATES = {
  explorer: {
    does: "the adventurer decides what to do with the turn",
    kind: "agent",
    calls: 1,
    edges: [
      { to: "propose", on: "acts", when: "commits to an action" },
      { to: "answer", on: "looks", when: "asks a question first" },
      { to: "narrate", on: "quiet", when: "nothing to do but let time pass" },
      { to: "explorer", on: "again", when: "said nothing usable" },
      { to: "awaiting_human", on: "stuck", when: "could not be reached" },
    ],
  },

  answer: {
    does: "the game master answers without the world moving",
    kind: "agent",
    calls: 1,
    edges: [{ to: "lore1", on: "answered", when: "the answer needs checking" }],
  },

  propose: {
    does: "the game master prices the action — how long, how tiring, how it could go",
    kind: "agent",
    calls: 1,
    edges: [
      { to: "gm", on: "priced", when: "the cost is settled" },
      { to: "propose", on: "again", when: "the proposal did not parse" },
    ],
  },

  gm: {
    does: "the game master narrates what happens",
    kind: "agent",
    calls: 1,
    edges: [
      { to: "lore1", on: "narrated", when: "an ordinary turn" },
      { to: "muster", on: "declares", when: "it declared a fight" },
    ],
  },

  muster: {
    does: "the only lore check a fight gets: the declaration and every body in it",
    kind: "agent",
    calls: 2,
    edges: [
      { to: "swing", on: "mustered", when: "the roster stands" },
      { to: "gm", on: "rejected", when: "the record will not bear it" },
      { to: "awaiting_human", on: "unwritten", when: "it named something nobody has written" },
    ],
  },

  swing: {
    does: "the adventurer is asked what to do with this round of theirs",
    kind: "agent",
    calls: 1,
    edges: [{ to: "fight", on: "chose", when: "they said what they are doing" }],
  },

  fight: {
    does: "one body takes its turn — the driver rolls, nobody argues",
    kind: "roll",
    calls: 0,
    edges: [
      { to: "swing", on: "theirs", when: "it is the adventurer's turn again" },
      { to: "fight", on: "next", when: "the next body acts" },
      { to: "blows", on: "over", when: "somebody is down or has run" },
    ],
  },

  blows: {
    does: "the game master puts words on the exchange that was already rolled",
    kind: "agent",
    calls: 1,
    edges: [{ to: "deliver", on: "written", when: "the fight was checked at its muster" }],
  },

  lore1: {
    does: "lore 1 reads the world out of the narration, lore 2 rules on every claim",
    kind: "agent",
    calls: 2,
    edges: [
      { to: "deliver", on: "stands", when: "nothing contradicts the record" },
      { to: "gm", on: "redraft", when: "a claim is FALSE, or the dice went against them" },
      { to: "blows", on: "rewrite", when: "the same rolled fight needs different words" },
      { to: "answer", on: "reanswer", when: "the answer needs redrafting" },
      { to: "awaiting_human", on: "unwritten", when: "the world is silent and cannot go on" },
    ],
  },

  deliver: {
    does: "the turn is applied — vitals, inventory, quests, the clock, the fight's wounds",
    kind: "roll",
    calls: 0,
    edges: [
      { to: "narrate", on: "resolved", when: "the turn happened" },
      { to: "explorer", on: "spent", when: "a question, an arrival or an event — the turn is not over" },
    ],
  },

  narrate: {
    does: "the narrator sets the turn down as a passage of the life",
    kind: "book",
    calls: 0,
    edges: [{ to: "done", on: "written", when: "it is in the book" }],
  },

  awaiting_human: {
    does: "the world is silent and holds until somebody writes what is missing",
    kind: "wait",
    calls: 0,
    edges: [
      { to: "gm", on: "ruled", when: "canon was written — narrate it again" },
      { to: "blows", on: "ruled_fight", when: "canon was written mid-fight" },
      { to: "answer", on: "ruled_answer", when: "canon was written for a question" },
    ],
  },

  awaiting_clock: {
    does: "they are walking, and real time has to pass before they arrive",
    kind: "wait",
    calls: 0,
    edges: [
      { to: "explorer", on: "arrived", when: "the road ran out" },
      { to: "awaiting_clock", on: "walking", when: "there is road left" },
    ],
  },

  done: {
    does: "the turn is closed and the next one begins",
    kind: "end",
    calls: 0,
    edges: [
      { to: "explorer", on: "next", when: "another turn" },
      { to: "awaiting_clock", on: "walks", when: "the turn put them on the road" },
    ],
  },
} as const satisfies Record<string, State>;

export type StateName = keyof typeof STATES;

export const STATE_NAMES = Object.keys(STATES) as StateName[];

/** Where a step in this state is allowed to go, by the edge name it returns. */
export function edgeFrom(state: StateName, on: string): Edge {
  const found = (STATES[state].edges as readonly Edge[]).find((e) => e.on === on);
  if (!found) {
    const legal = STATES[state].edges.map((e) => e.on).join(", ");
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
      kind: STATES[name].kind,
      calls: STATES[name].calls,
    })),
    edges: STATE_NAMES.flatMap((from) =>
      (STATES[from].edges as readonly Edge[]).map((e) => ({
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
