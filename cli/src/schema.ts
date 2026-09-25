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
import { DEFAULTS, GODHEAD_ID, MAX_HEALTH, STARTING_SKILLS, WORLD_START } from "./config.ts";

export const Id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "an id is kebab-case");

/** `1–2`, `2-5`, or a bare number — what one blow takes off. */
export const BAND = /(\d+)\s*[–—-]\s*(\d+)|^\s*(\d+)\s*$/;

export const Band = z.string().regex(BAND, "a damage band reads `1–2`");

export const Written = z.record(z.string(), z.unknown());

export const Vitals = z.object({
  health: z.number().int().min(0).max(100).default(MAX_HEALTH),
  fatigue: z.number().int().min(0).max(100).default(0),
  hunger: z.number().int().min(0).max(100).default(0),
});

export const Time = z.object({
  era: z.number().int(),
  year: z.number().int(),
  day: z.number().int(),
  minute: z.number().int(),
  stamp: z.string().optional(),
  long: z.string().optional(),
});

export const Clock = z.object({
  hours_per_league: z.number().default(DEFAULTS.hours_per_league),
  min_leg_minutes: z.number().default(DEFAULTS.min_leg_minutes),
  encounter_chance_per_league: z.number().default(DEFAULTS.encounter_chance_per_league),
  speed_factor: z.number().default(DEFAULTS.speed_factor),
});

export const Skills = z.object({
  abilities: z.record(z.string(), z.number().int()).default({}),
  proficiency: z.number().int().default(0),
  proficient: z.array(z.string()).default([]),
});

export const Sessions = z.object({
  explorer: z.string().nullish(),
  gm: z.string().nullish(),
  lore3_sitting: z.string().nullish(),
});

export const Placed = z.object({ id: z.string(), name: z.string() });

export const QuestStatus = z.enum(["active", "done", "failed", "abandoned"]);

export const Quest = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string().default(""),
  giver: z.string().optional(),
  script: z.string().default(""),
  at: z.string(),
  status: QuestStatus,
  opened: z.string(),
  closed: z.string().nullish(),
  closed_at: z.string().optional(),
  where: z.array(Placed).default([]),
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

export const Spawn = z.object({
  name: z.string(),
  who: z.string().nullish(),
  count: z.coerce.number().int().min(1).default(1),
  health: z.coerce.number().int().min(0).nullish(),
  most: z.coerce.number().int().min(0).nullish(),
  damage: Band.nullish(),
  dc: z.coerce.number().int().min(0).nullish(),
  bonus: z.coerce.number().int().nullish(),
  defense: z.coerce.number().int().min(0).nullish(),
  skill: z.string().nullish(),
});

export const Ability = z.object({
  name: z.string().optional(),
  damage: Band.nullish(),
  advantage: z.coerce.boolean().default(false),
  cooldown: z.number().int().min(0).default(0),
  sleep: z.number().int().min(0).default(0),
  delay: z.number().int().min(0).default(0),
  spawn: Spawn.nullish(),
  within: z.string().nullish(),
  in_kind: z.string().nullish(),
  in_aspect: z.string().nullish(),
  from: z.string().nullish(),
  used: z.boolean().default(false),
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
  as_written: Written.default({}),
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
    spawn: Spawn,
  })).default([]),
});

/** What the adventurer chose to do with one round. The mark is an id, and so is the item. */
export const Swing = z.discriminatedUnion("verb", [
  z.object({ verb: z.literal("ATTACK"), mark: Id.nullish() }),
  z.object({ verb: z.literal("SKILL"), skill: z.string(), mark: Id.nullish() }),
  z.object({ verb: z.literal("ITEM"), item: z.string() }),
  z.object({ verb: z.literal("FLEE") }),
]);

export const Claim = z.object({
  id: z.string(),
  text: z.string(),
  entity: z.string().nullish(),
  kind: z.string().nullish(),
});

export const Result = z.enum(["TRUE", "WITHIN_BOUNDS", "FALSE", "UNRESOLVED"]);

export const Verdict = z.object({
  claim: z.string(),
  result: z.preprocess(
    (said) => (String(said ?? "") || "TRUE").toUpperCase().replace(/[^A-Z]+/g, "_").replace(/^_+|_+$/g, ""),
    Result.catch("UNRESOLVED"),
  ),
  why: z.string().default(""),
  question: z.string().default(""),
  alternative: z.string().default(""),
  sources: z.array(z.coerce.string()).default([]),
});

const Whole = z.preprocess(
  (said) => (said === "" ? null : said),
  z.coerce.number().transform(Math.trunc).pipe(z.number().int()).nullish(),
);

const WholeOr = (fallback: number) => Whole.transform((n) => n ?? fallback);

const Holder = z.string().nullish().transform((said) => said || GODHEAD_ID);

export const Listed = <T extends z.ZodType>(item: T) => z.array(item).nullish().transform((items) => items ?? []);

export const Transaction = z.object({
  from: Holder,
  to: Holder,
  name: z.string(),
  qty: WholeOr(1),
});

/** What the game master handed back, before anything has been applied. */
export const Draft = z.object({
  narration: z.string().default(""),
  claims: z.array(Claim).default([]),
  destination: z.string().nullish(),
  minutes: WholeOr(0).transform((n) => Math.max(0, n)),
  fatigue: WholeOr(0),
  health: WholeOr(0),
  hunger: Whole,
  check: z.object({ skill: z.string(), dc: WholeOr(10) }).nullish(),
  fight: Written.nullish(),
  transactions: Listed(Transaction),
  quest_open: Listed(z.unknown()),
  quest_update: Listed(z.unknown()),
  quest_close: Listed(z.unknown()),
});

export const PhaseKind = z.enum(["action", "look", "say", "answer", "outcome", "world", "fight"]);

export const Outcome = z.object({ band: z.string(), text: z.string(), p: z.number() });

export const Phase = z.object({
  n: z.number().int().optional(),
  who: z.enum(["explorer", "gm"]),
  kind: PhaseKind,
  status: z.enum(["pending", "checked", "blocked", "said"]).default("pending"),
  text: z.string().default(""),
  claims: z.array(Claim.extend({ verdict: Verdict.nullish() })).default([]),
  fight: Fight.nullish(),
  minutes: z.number().int().optional(),
  fatigue: z.number().int().optional(),
  roll: z.number().int().nullish(),
  outcomes: z.array(Outcome).optional(),
  chosen: Outcome.nullish(),
  fortune: z.number().nullish(),
  check: Check.nullish(),
});

export const Proposal = z.object({
  summary: z.string(),
  target: z.string().nullish(),
  minutes: z.number().int(),
  fatigue: z.number().int(),
  unpriced: z.boolean().optional(),
});

export const Exchange = z.object({ question: z.string().nullish(), answer: z.string() });

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
  chosen: Outcome.nullish(),
  outcomes: z.array(Outcome).default([]),
  check: Check.nullish(),

  note: z.string().nullish(),
  event: z.string().nullish(),
  arrival: Id.nullish(),
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
  proposal: Proposal.nullish(),
  confirmed: z.boolean().default(false),
  propose_retries: z.number().int().min(0).default(0),
  blank: z.number().int().min(0).default(0),
  nudge: z.number().int().min(0).default(0),
  ready: z.string().nullish(),
  pressed: z.boolean().nullish(),
  forced_strange: z.boolean().default(false),
  fortune: z.number().nullish(),
  looks: z.array(Exchange).default([]),
  talks: z.array(Exchange).default([]),
  context: z.array(Exchange).default([]),
  /** where the road is taking them, and how much of it is left */
  destination: Id.nullish(),
  leagues_left: z.number().default(0),
  /** the way the map says they are going, and how much of it this stretch covers */
  path: z.array(z.tuple([z.number(), z.number()])).nullish(),
  reach: z.number().nullish(),
  /** the lore master's sitting, archived onto the turn that needed it */
  lore: z.array(z.object({ role: z.string(), text: z.string() })).default([]),
  lore_gap: z.string().nullish(),

  minutes: z.number().int().min(0).default(0),
  wake_at: z.string().nullish(),
  at: z.string().nullish(),
  vitals: Vitals.nullish(),
  location_path: z.array(Placed).default([]),
  quest: z.string().nullish(),
  chronicle: z.array(z.object({ ord: z.number().int(), text: z.string() })).default([]),
});

export const Carried = Fight.pick({ skill: true, flee_dc: true, name: true, us: true, them: true });

export const Campaign = z.object({
  created: z.string(),
  // A world that has just been made has no adventurer, no turn and nowhere to
  // stand until the first one opens. Requiring any of them makes `init` fail on
  // the campaign it has only just written.
  explorer: z.string().nullish(),
  current_turn: z.string().nullish(),
  turn_counter: z.number().int().min(0),
  location: Id.nullish(),
  location_path: z.array(Placed).default([]),
  vitals: Vitals.prefault({}),
  skills: Skills.default(() => structuredClone(STARTING_SKILLS)),
  quests: z.array(Quest).default([]),
  time: Time.default(() => ({ ...WORLD_START })),
  clock: Clock.prefault({}),
  sessions: Sessions.prefault({}),
  sent: z.record(z.string(), z.string()).default({}),
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
  fight: Carried.nullish(),
});

export type TurnT = z.infer<typeof Turn>;
export type CampaignT = z.infer<typeof Campaign>;
export type PhaseT = z.infer<typeof Phase>;
export type FightT = z.infer<typeof Fight>;
export type FighterT = z.infer<typeof Fighter>;
export type BlowT = z.infer<typeof Blow>;
export type AbilityT = z.infer<typeof Ability>;
export type SpawnT = z.infer<typeof Spawn>;
export type DraftT = z.infer<typeof Draft>;
export type SwingT = z.infer<typeof Swing>;
export type ClaimT = z.infer<typeof Claim>;
export type VerdictT = z.infer<typeof Verdict>;
export type CheckT = z.infer<typeof Check>;
export type OutcomeT = z.infer<typeof Outcome>;
export type ProposalT = z.infer<typeof Proposal>;
export type QuestT = z.infer<typeof Quest>;
export type PlacedT = z.infer<typeof Placed>;
export type TimeT = z.infer<typeof Time>;
export type ClockT = z.infer<typeof Clock>;
export type VitalsT = z.infer<typeof Vitals>;
export type CarriedT = z.infer<typeof Carried>;
