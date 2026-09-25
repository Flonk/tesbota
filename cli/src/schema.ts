/**
 * What a turn is, and the whole of it.
 *
 * One shape, declared once. Everything that crosses a boundary — disk, the web,
 * a step's hands — is parsed through here, so a field that does not exist cannot
 * be read and a field of the wrong kind cannot be written.
 *
 * Two rules earned the hard way:
 *
 *  - A body is referred to by its id, never held. Keeping the body itself worked
 *    in memory and broke the moment a turn went to disk and came back, because
 *    the copy in `swing.mark` and the copy in `fight.them` stopped being the same
 *    object and every wound landed on the orphan. Ids do not have that failure.
 *  - A fight lives in exactly one place. `campaign.fight` is not a fight; it is
 *    what is carried out of one that nobody finished.
 */

import { z } from "zod";
import { STATE_NAMES } from "./machine.ts";

export const Id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "an id is kebab-case");

/** `1–2`, `2-5`, or a bare number — what one blow takes off. */
export const Band = z.string().regex(/^\s*\d+\s*(?:[–—-]\s*\d+\s*)?$/, "a damage band reads `1–2`");

export const Vitals = z.object({
  health: z.number().int().min(0).max(100),
  fatigue: z.number().int().min(0).max(100),
  hunger: z.number().int().min(0).max(100),
});

export const Check = z.object({
  skill: z.string(),
  dc: z.number().int(),
  roll: z.number().int(),
  rolls: z.array(z.number().int()).default([]),
  against: z.array(z.string()).default([]),
  for: z.array(z.string()).default([]),
  bonus: z.number().int().default(0),
  total: z.number().int(),
  passed: z.boolean(),
});

export const Ability = z.object({
  name: z.string().optional(),
  damage: Band.nullish(),
  advantage: z.coerce.boolean().default(false),
  cooldown: z.number().int().min(0).default(0),
  sleep: z.number().int().min(0).default(0),
  delay: z.number().int().min(0).default(0),
  spawn: z.object({ name: z.string(), count: z.number().int().min(1).default(1) }).nullish(),
  within: z.string().nullish(),
  in_kind: z.string().nullish(),
  in_aspect: z.string().nullish(),
  from: z.string().nullish(),
  used: z.boolean().default(false),
});

/** What the world keeps about a thing that can be fought. */
export const BodyRecord = z.object({
  health: z.number().int().positive().nullish(),
  damage: Band.nullish(),
  dc: z.number().int().positive().nullish(),
  bonus: z.number().int().default(0),
  defense: z.number().int().min(0).default(0),
  skill: z.string().nullish(),
});

export const Side = z.enum(["explorer", "ally", "foe"]);

/** One body standing in a fight. `id` is the whole of its identity. */
export const Fighter = z.object({
  id: Id,
  name: z.string(),
  kind: Side,
  health: z.number().int().min(0),
  most: z.number().int().positive(),
  opened: z.number().int().min(0),
  damage: Band,
  weapon: z.string().nullish(),
  dc: z.number().int().positive(),
  bonus: z.number().int().default(0),
  defense: z.number().int().min(0).default(0),
  skill: z.string().nullish(),
  ability: Ability.nullish(),
  aspects: z.array(z.object({ name: z.string(), value: z.string().nullish(), of: z.string().nullish() })).default([]),
  asleep: z.number().int().min(0).default(0),
  cool: z.number().int().min(0).default(0),
  dead: z.boolean().default(false),
  /** exactly what the game master wrote, so a rebound body can be rebuilt */
  as_written: z.record(z.string(), z.unknown()).default({}),
});

export const Blow = z.object({
  n: z.number().int().positive(),
  round: z.number().int().positive(),
  who: Id,
  name: z.string(),
  side: z.enum(["us", "them"]),
  chose: z.string().default("ATTACK"),
  hit: z.boolean().default(false),
  dealt: z.number().int().min(0).default(0),
  taken: z.number().int().min(0).default(0),
  blocked: z.number().int().min(0).nullish(),
  /** the id of what was struck — an id, never the body */
  at: Id.nullish(),
  atname: z.string().nullish(),
  left: z.number().int().min(0).nullish(),
  check: Check.nullish(),
  spawned: z.string().nullish(),
  calling: z.string().nullish(),
  mended: z.string().nullish(),
  spent: z.boolean().default(false),
  text: z.string().default(""),
  /** health of every body the instant after this blow, for the bars to animate */
  us: z.array(z.object({ id: Id, health: z.number().int().min(0), dead: z.boolean() })).default([]),
  them: z.array(z.object({ id: Id, health: z.number().int().min(0), dead: z.boolean() })).default([]),
});

export const Ended = z.enum(["beaten", "killed", "fled", "broken"]);

export const Fight = z.object({
  skill: z.string(),
  flee_dc: z.number().int(),
  name: z.string().default("it"),
  said: z.string().default(""),
  round: z.number().int().positive().default(1),
  turn: z.number().int().min(0).default(0),
  ended: Ended.nullish(),
  us: z.array(Fighter),
  them: z.array(Fighter),
  blows: z.array(Blow).default([]),
  owed: z.array(z.object({
    at: z.number().int(),
    by: z.string(),
    spawn: z.object({ name: z.string(), count: z.number().int().min(1).default(1) }),
  })).default([]),
});

/** What the adventurer chose to do with one round. The mark is an id. */
export const Swing = z.object({
  verb: z.enum(["ATTACK", "ITEM", "SKILL", "FLEE"]),
  what: z.union([z.string(), z.record(z.string(), z.unknown())]).nullish(),
  mark: Id.nullish(),
});

export const Claim = z.object({
  id: z.string(),
  text: z.string(),
  entity: z.string().nullish(),
  kind: z.string().nullish(),
});

export const Result = z.enum(["TRUE", "WITHIN_BOUNDS", "FALSE", "UNRESOLVED"]);

export const Verdict = z.object({
  claim: z.string(),
  result: Result,
  why: z.string().default(""),
  question: z.string().default(""),
  alternative: z.string().default(""),
  sources: z.array(z.string()).default([]),
});

export const Transaction = z.object({
  from: z.string(),
  to: z.string(),
  name: z.string(),
  qty: z.number().int().default(1),
});

/** What the game master handed back, before anything has been applied. */
export const Draft = z.object({
  narration: z.string().default(""),
  claims: z.array(Claim).default([]),
  destination: z.string().nullish(),
  minutes: z.number().int().min(0).default(0),
  fatigue: z.number().int().default(0),
  health: z.number().int().default(0),
  hunger: z.number().int().nullish(),
  check: z.object({ skill: z.string(), dc: z.number().int() }).nullish(),
  fight: z.record(z.string(), z.unknown()).nullish(),
  transactions: z.array(Transaction).default([]),
  quest_open: z.array(z.unknown()).default([]),
  quest_update: z.array(z.unknown()).default([]),
  quest_close: z.array(z.unknown()).default([]),
});

export const PhaseKind = z.enum(["action", "look", "say", "answer", "outcome", "world", "fight"]);

export const Phase = z.object({
  n: z.number().int().optional(),
  who: z.enum(["explorer", "gm", "driver"]),
  kind: PhaseKind,
  status: z.enum(["pending", "checked", "blocked", "said"]).default("pending"),
  text: z.string().default(""),
  claims: z.array(Claim.extend({ verdict: Verdict.nullish() })).default([]),
  fight: Fight.nullish(),
  minutes: z.number().int().optional(),
  fatigue: z.number().int().optional(),
  check: Check.nullish(),
});

export const StateName = z.enum(STATE_NAMES);

/** One edge of the machine, crossed. Two states name it; `on` is what the step said. */
export const Crossing = z.object({
  from: StateName,
  to: StateName,
  at: z.string(),
  on: z.string().optional(),
});

export const Turn = z.object({
  turn_id: z.string().regex(/^t\d{4}$/),
  state: StateName,
  created: z.string(),

  action: z.string().nullish(),
  draft: Draft.nullish(),
  phases: z.array(Phase).default([]),
  verdicts: z.array(Verdict).default([]),
  facts: z.array(z.string()).default([]),

  fight: Fight.nullish(),
  swing: Swing.nullish(),

  correction: z.string().nullish(),
  gm_retries: z.number().int().min(0).default(0),
  gap: z.string().nullish(),

  looking: z.boolean().default(false),
  mode: z.enum(["look", "say"]).nullish(),
  question: z.string().nullish(),
  /** a question and the answer to it — written as a pair, and read as one */
  answers: z.array(z.tuple([z.string(), z.string()])).default([]),

  roll: z.number().int().nullish(),
  rolled: z.boolean().default(false),
  fate: z.string().nullish(),
  chosen: z.record(z.string(), z.unknown()).nullish(),
  outcomes: z.array(z.unknown()).default([]),
  check: Check.nullish(),

  note: z.string().nullish(),
  event: z.string().nullish(),
  arrival: z.string().nullish(),
  opening: z.boolean().default(false),
  delivered: z.boolean().default(false),
  resolved: z.boolean().default(false),
  spent: z.array(z.string()).default([]),

  /** the edge the driver last crossed, and the ones before it — what the dev tab draws */
  took: Crossing.nullish(),
  trail: z.array(Crossing).default([]),

  // What a turn carries between its own steps. These are working state, not the
  // record — but they are declared here all the same, because anything left out
  // is silently dropped the next time the turn is read off disk, and a proposal
  // that vanishes between `propose` and `gm` is a turn that quietly re-prices
  // itself.
  proposal: z.record(z.string(), z.unknown()).nullish(),
  confirmed: z.boolean().default(false),
  propose_retries: z.number().int().min(0).default(0),
  blank: z.number().int().min(0).default(0),
  nudge: z.number().int().min(0).default(0),
  ready: z.string().nullish(),
  pressed: z.boolean().nullish(),
  forced_strange: z.boolean().default(false),
  fortune: z.number().nullish(),
  looks: z.array(z.unknown()).default([]),
  talks: z.array(z.unknown()).default([]),
  context: z.array(z.unknown()).default([]),
  /** where the road is taking them, and how much of it is left */
  destination: z.string().nullish(),
  leagues_left: z.number().default(0),
  /** the way the map says they are going, and how much of it this stretch covers */
  path: z.array(z.tuple([z.number(), z.number()])).nullish(),
  reach: z.number().nullish(),
  /** the lore master's sitting, archived onto the turn that needed it */
  lore: z.array(z.unknown()).default([]),
  lore_gap: z.string().nullish(),

  minutes: z.number().int().min(0).default(0),
  wake_at: z.string().nullish(),
  at: z.string().nullish(),
  vitals: Vitals.nullish(),
  location_path: z.array(z.unknown()).default([]),
  quest: z.string().nullish(),
  chronicle: z.array(z.unknown()).default([]),
});

export const Campaign = z.object({
  created: z.string(),
  // A world that has just been made has no adventurer, no turn and nowhere to
  // stand until the first one opens. Requiring any of them makes `init` fail on
  // the campaign it has only just written.
  explorer: z.string().nullish(),
  current_turn: z.string().nullish(),
  turn_counter: z.number().int().min(0),
  location: Id.nullish(),
  location_path: z.array(z.unknown()).default([]),
  vitals: Vitals,
  skills: z.record(z.string(), z.unknown()).default({}),
  quests: z.array(z.unknown()).default([]),
  time: z.record(z.string(), z.unknown()),
  clock: z.record(z.string(), z.unknown()),
  sessions: z.record(z.string(), z.string().nullable()).default({}),
  sent: z.record(z.string(), z.unknown()).default({}),
  last_narration: z.string().nullish(),
  last_seen: z.string().nullish(),
  note: z.string().nullish(),
  paused: z.boolean().nullish(),
  quiet: z.number().int().default(0),
  calm: z.number().int().default(0),
  settled: z.array(z.string()).default([]),
  /** everywhere they have stood, worked out once and kept rather than re-read */
  walked: z.array(z.string()).default([]),
  walked_through: z.string().nullish(),
  /** not a fight — what was carried out of one nobody finished */
  fight: z.object({
    skill: z.string(),
    flee_dc: z.number().int(),
    us: z.array(Fighter),
    them: z.array(Fighter),
  }).nullish(),
});

/**
 * The one thing a transition is handed and the one thing it gives back. A step
 * takes this, changes it, and returns the name of the edge it is taking — it
 * never says what state comes next, because that is the machine's to know.
 */
export type World = {
  campaign: z.infer<typeof Campaign>;
  turn: z.infer<typeof Turn>;
};

export type TurnT = z.infer<typeof Turn>;
export type CampaignT = z.infer<typeof Campaign>;
export type FightT = z.infer<typeof Fight>;
export type FighterT = z.infer<typeof Fighter>;
export type BlowT = z.infer<typeof Blow>;
export type DraftT = z.infer<typeof Draft>;
export type SwingT = z.infer<typeof Swing>;
export type VerdictT = z.infer<typeof Verdict>;
