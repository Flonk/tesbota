/**
 * The transitions, one function each.
 *
 * A step is handed the world, changes it, and returns the name of the edge it is
 * taking. It never says what state comes next — `machine.ts` owns that, and an
 * edge that is not declared there cannot be taken. This is the whole of the
 * difference from what came before, where thirty-eight scattered assignments
 * decided the shape of the machine between them and nothing could be read off.
 */

import { z } from "zod";
import * as canon from "./canon.ts";
import * as chronicle from "./chronicle.ts";
import * as fight from "./fight.ts";
import * as prompts from "./prompts.ts";
import * as sheet from "./sheet.ts";
import * as worldclock from "./worldclock.ts";
import { AgentError, ask, extractJson } from "./agent.ts";
import { sqliteGate, type Gate } from "./gate.ts";
import type { EdgeOn, LoopState } from "./machine.ts";
import { random, type Rng } from "./rng.ts";
import { explorerName, pendingDeath, recordDeath } from "./state.ts";
import {
  Blow, Claim, Draft, Listed, QuestStatus, Verdict, Written,
  type BlowT, type CampaignT, type CheckT, type ClaimT, type DraftT, type FightT, type FighterT,
  type OutcomeT, type PhaseT, type QuestT, type SwingT, type TurnT, type VerdictT,
} from "./schema.ts";
import {
  BANDS, BLOW_FATIGUE, BLOW_MINUTES, DIE, EXPLORER, GODHEAD_ID, HUNGER_PER_HOUR,
  MAX_ASKS, MAX_BLOWS, MAX_FATIGUE, MAX_GM_RETRIES, MAX_HEALTH, MAX_HUNGER,
  MAX_LOOKS, MAX_PROPOSE_RETRIES, MAX_TALKS, MODELS, PRESS_FLOOR, READ_TOOLS, SKILL_DIE,
  SPARK_FLOOR, TRIVIAL_FATIGUE, TRIVIAL_MINUTES, WEIGHT,
} from "./config.ts";

/** What a step is handed, and the only thing it is handed. */
export type World = { campaign: CampaignT; turn: TurnT };

/** What a step gives back: the name of one edge out of the state it was in. */
export type Step<S extends LoopState> = (world: World, rng?: Rng) => Promise<EdgeOn<S>>;

function drafted(turn: TurnT): DraftT {
  if (!turn.draft) throw new Error(`${turn.turn_id} has no draft`);
  return turn.draft;
}

export function fightOf(turn: TurnT): FightT {
  if (!turn.fight) throw new Error(`${turn.turn_id} has no fight`);
  return turn.fight;
}

// ── phases ──────────────────────────────────────────────────────────────────

export function phase(
  turn: TurnT, who: PhaseT["who"], kind: PhaseT["kind"], text: string, extra: Partial<PhaseT> = {}
): PhaseT {
  const entry: PhaseT = {
    n: turn.phases.length + 1,
    who,
    kind,
    text,
    status: who === "explorer" ? "said" : "pending",
    claims: [],
    ...extra,
  };
  turn.phases.push(entry);
  return entry;
}

/**
 * Append what the game master said. A pending phase is rewritten in place — that
 * only happens when the lore master has sent it back.
 */
export function gmPhase(turn: TurnT, kind: PhaseT["kind"], text: string, extra: Partial<PhaseT> = {}): PhaseT {
  const last = openPhase(turn);
  if (last) {
    last.kind = kind;
    last.text = text;
    Object.assign(last, extra);
    return last;
  }
  return phase(turn, "gm", kind, text, extra);
}

export function openPhase(turn: TurnT): PhaseT | null {
  const last = turn.phases[turn.phases.length - 1];
  return last && last.who === "gm" && last.status === "pending" ? last : null;
}

// ── the explorer ────────────────────────────────────────────────────────────

const EXPLORER_COMMANDS = ["tesbota stats", "tesbota inventory", "tesbota quests"];

export function normaliseCommand(text: string): string {
  let parts = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts[0] === "uv" && parts[1] === "run") parts = parts.slice(2);
  return parts.join(" ");
}

export const explorerPermission: Gate = async (toolName, toolInput) => {
  if (toolName !== "Bash") {
    return {
      behavior: "deny" as const,
      message: "You have no such power. You may run tesbota stats, tesbota inventory or tesbota quests.",
    };
  }
  const raw = String(toolInput.command ?? "");
  const parts = raw.split(/&&|;|\n/).map(normaliseCommand).filter((p) => p && !/^echo\b/.test(p));
  const shell = [..."|&$`><"].some((ch) => raw.replace(/&&/g, "").includes(ch));
  if (!shell && parts.length && parts.every((p) => EXPLORER_COMMANDS.includes(p))) {
    return { behavior: "allow" as const };
  }
  return {
    behavior: "deny" as const,
    message:
      "Nothing happens. The only things you can do are `tesbota stats`, " +
      "`tesbota inventory` and `tesbota quests`, one at a time.",
  };
};

const ACTION_PREFIX = ["ACTION:", "DO:", "ACT:"];

/** The explorer is told the action needs no prefix and writes one anyway. */
export function unprefixed(text: string | null | undefined): string {
  const bare = String(text ?? "").trim();
  for (const mark of ACTION_PREFIX) {
    if (bare.toUpperCase().startsWith(mark)) return bare.slice(mark.length).trim();
  }
  return bare;
}

export function firstUtterance(text: string | null | undefined): string {
  const kept: string[] = [];
  for (const line of String(text ?? "").trim().split("\n")) {
    const bare = line.trim();
    if (!bare) {
      if (kept.length) break;
      continue;
    }
    if (normaliseCommand(bare).split(" ")[0] === "tesbota") continue;
    if (bare.toUpperCase().startsWith("LOOK:") || bare.toUpperCase().startsWith("SAY:")) {
      if (kept.length) break;
      return bare;
    }
    kept.push(bare);
  }
  return unprefixed(kept.join(" ").trim());
}

const DONE_WORDS = [
  "done", "nothing further", "nothing else", "nothing more", "that is all",
  "that's all", "thats all", "ready", "no more", "move on", "finished",
  "i'm good", "im good", "carry on", "let's go", "lets go",
];

const QUOTES = "\"'“‘„«";

/**
 * Work out whether an utterance is a look, a say, or the end of the turn. The
 * prefixes are honoured when given; otherwise a question is a look and speech is
 * a say, so the explorer need not remember the syntax.
 */
export function classify(text: string, turn: TurnT): ["look" | "say" | "done", string] {
  const stripped = unprefixed(text);
  const upper = stripped.toUpperCase();

  if (upper.startsWith("LOOK:")) return ["look", stripped.slice(5).trim()];
  if (upper.startsWith("SAY:")) return ["say", stripped.slice(4).trim()];

  const bare = stripped.toLowerCase().replace(/^[.!… ]+|[.!… ]+$/g, "");
  if (DONE_WORDS.some((w) => bare === w || bare.startsWith(w + " ") || bare.startsWith("i am " + w))) {
    return ["done", stripped];
  }
  if (bare.length <= 48 && DONE_WORDS.some((w) => bare.includes(w))) return ["done", stripped];

  const looksLeft = turn.looks.length < MAX_LOOKS;
  const talksLeft = turn.talks.length < MAX_TALKS;

  if (QUOTES.includes(stripped.slice(0, 1)) && talksLeft) {
    return ["say", stripped.replace(new RegExp(`^[${QUOTES}”’»]+|[${QUOTES}”’»]+$`, "g"), "")];
  }
  if (stripped.endsWith("?")) {
    if (looksLeft) return ["look", stripped];
    if (talksLeft) return ["say", stripped];
  }
  return ["done", stripped];
}

export const stepExplorer: Step<"explorer"> = async ({ campaign, turn }) => {
  const [text, session] = await ask(
    prompts.explorerTurn(campaign.last_narration ?? null, turn.nudge, turn.check),
    {
      system: prompts.EXPLORER_SYSTEM(),
      tools: ["Bash"],
      session: campaign.sessions.explorer,
      model: MODELS.explorer,
      permission: explorerPermission,
    }
  );
  campaign.sessions.explorer = session;

  const stripped = firstUtterance(text);
  const upper = stripped.toUpperCase();
  const asked = upper.startsWith("LOOK:") || upper.startsWith("SAY:");

  if (!stripped) {
    turn.blank += 1;
    if (turn.blank >= MAX_ASKS) {
      turn.gap =
        "The adventurer has said nothing that can be acted on:\n\n" +
        String(text ?? "").trim().slice(0, 600);
      return "stuck";
    }
    return "again";
  }

  if (!turn.action && !asked) {
    turn.action = stripped;
    phase(turn, "explorer", "action", stripped);
    return "acts";
  }

  if (!turn.action && asked) {
    turn.nudge += 1;
    if (turn.nudge < MAX_ASKS) return "again";
    turn.action = stripped.split(":").slice(1).join(":").trim();
    phase(turn, "explorer", "action", turn.action);
    return "acts";
  }

  const [kind, said] = classify(stripped, turn);
  const room = { look: MAX_LOOKS - turn.looks.length, say: MAX_TALKS - turn.talks.length };

  if (kind !== "done" && room[kind] > 0) {
    turn.question = said;
    turn.mode = kind;
    turn.looking = true;
    phase(turn, "explorer", kind, said);
    return "looks";
  }

  turn.ready = said;
  if (turn.resolved) {
    turn.delivered = true;
    return "quiet";
  }
  return "acts";
};

/** The turn is over and it survived adjudication. It is set down as it stands. */
export const stepNarrate: Step<"narrate"> = async ({ turn }) => {
  if (chronicle.played(turn)) {
    const written = chronicle.write(turn);
    if (written.length) turn.chronicle = [...turn.chronicle, ...written];
  }
  return "written";
};

/**
 * What the game master's session has already been handed. A session that has gone
 * means it has been handed nothing, so the slate goes with it.
 */
export function ledger(campaign: CampaignT): Record<string, string> {
  if (!campaign.sessions.gm) campaign.sent = {};
  return campaign.sent;
}

export const stepAnswer: Step<"answer"> = async ({ campaign, turn }) => {
  const [text, session] = await ask(
    prompts.gmAnswer(turn.question ?? "", {
      previous: campaign.last_narration ?? null,
      mode: turn.mode || "look",
      inventory: canon.holdings(EXPLORER),
      load: sheet.load(campaign),
      others: canon.holdingsAt(campaign.location),
      correction: turn.correction ?? null,
      sent: ledger(campaign),
    }),
    {
      system: prompts.GM_SYSTEM(),
      tools: READ_TOOLS,
      permission: sqliteGate({ also: ["tesbota around", "tesbota route"] }),
      session: campaign.sessions.gm,
      model: MODELS.gm,
    }
  );
  campaign.sessions.gm = session;
  const draft = Draft.parse({
    ...extractJson(text, Written), claims: [], destination: null, minutes: 0, fatigue: 0, health: 0, check: null,
  });
  turn.draft = draft;
  gmPhase(turn, "answer", draft.narration);
  turn.correction = null;
  return "answered";
};

/**
 * Six ways it could go, one to a band up the ladder, weights made to add up. A
 * malformed table is thrown away; a missing weight falls back to its band.
 */
export function weighOutcomes(raw: unknown): OutcomeT[] {
  const entries = (Array.isArray(raw) ? raw : []).flatMap((e: unknown) => {
    const entry = Written.safeParse(e).data;
    return entry && String(entry.text || "").trim() ? [entry] : [];
  });
  const kept: Record<string, unknown>[] = [];
  const used = new Set<Record<string, unknown>>();
  for (const wanted of BANDS) {
    const match = entries.find((e) => e.band === wanted && !used.has(e));
    if (!match) return [];
    used.add(match);
    kept.push(match);
  }
  const out = kept.map((entry) => {
    const band = String(entry.band);
    let weight = Number(entry.p);
    if (!(weight > 0)) weight = WEIGHT[band];
    return { band, text: String(entry.text).trim(), p: weight };
  });
  const total = out.reduce((a, e) => a + e.p, 0);
  for (const entry of out) entry.p = entry.p / total;
  return out;
}

export function spin(outcomes: OutcomeT[], fortune: number, only?: string | string[] | null): OutcomeT {
  const wanted = typeof only === "string" ? [only] : only;
  let pool = wanted ? outcomes.filter((e) => wanted.includes(e.band)) : [...outcomes];
  if (!pool.length) pool = [...outcomes];
  const total = pool.reduce((a, e) => a + e.p, 0);
  const edge = fortune * total;
  let running = 0;
  for (const entry of pool) {
    running += entry.p;
    if (edge < running) return entry;
  }
  return pool[pool.length - 1];
}

export const stepPropose: Step<"propose"> = async ({ campaign, turn }, rng = random) => {
  if (campaign.note && !turn.note) {
    turn.note = campaign.note;
    campaign.note = null;
  }

  const [text] = await ask(
    prompts.gmPropose(turn.action, {
      previous: campaign.last_narration ?? null,
      vitals: campaign.vitals,
      answers: turn.answers,
      note: turn.note ?? null,
      inventory: canon.holdings(EXPLORER),
      load: sheet.load(campaign),
      others: canon.holdingsAt(campaign.location),
      now: worldclock.longStamp(campaign.time),
    }),
    {
      system: prompts.GM_PROPOSE_SYSTEM(),
      tools: READ_TOOLS,
      permission: sqliteGate({ also: ["tesbota around", "tesbota route"] }),
      session: null,
      model: MODELS.gm,
    }
  );
  const out = extractJson(text, Written);

  const question = typeof out.ask === "string" ? out.ask.trim() : null;
  const answers = turn.answers;
  if (question && answers.length < MAX_ASKS) {
    const [reply] = await ask(prompts.lore1Query(question), {
      system: prompts.LORE1_QUERY_SYSTEM(),
      tools: READ_TOOLS,
      permission: sqliteGate({ also: ["tesbota around", "tesbota route"] }),
      session: null,
      model: MODELS.lore1,
    });
    answers.push([question, reply.trim()]);
    return "again";
  }

  const said = Written.safeParse(out.proposal).data;

  if (!said || !("minutes" in said)) {
    turn.propose_retries += 1;
    if (turn.propose_retries < MAX_PROPOSE_RETRIES) return "again";
    turn.proposal = {
      summary: turn.action || "",
      target: null,
      minutes: TRIVIAL_MINUTES,
      fatigue: TRIVIAL_FATIGUE,
      unpriced: true,
    };
  } else {
    turn.proposal = {
      summary: String(said.summary ?? (turn.action || "")),
      target: typeof said.target === "string" ? said.target : null,
      minutes: Math.trunc(Number(said.minutes) || 0),
      fatigue: Math.trunc(Number(said.fatigue) || 0),
    };
  }

  const outcomes = weighOutcomes(out.outcomes);
  if (outcomes.length) {
    const strange = campaign.quiet >= SPARK_FLOOR;
    const fortune = rng.next();
    turn.outcomes = outcomes;
    turn.fortune = fortune;
    turn.chosen = spin(outcomes, fortune, strange ? ["epic", "legendary"] : null);
    turn.forced_strange = strange;
  }

  turn.confirmed = true;
  return "priced";
};

export function duePress(turn: TurnT, campaign?: CampaignT | null): boolean {
  return (turn.pressed ??= (campaign?.calm || 0) >= PRESS_FLOOR);
}

export const stepGm: Step<"gm"> = async ({ campaign, turn }) => {
  const agreed = turn.confirmed ? turn.proposal : null;
  const [text, session] = await ask(
    prompts.gmTurn(turn.action, {
      previous: campaign.last_narration ?? null,
      vitals: campaign.vitals,
      correction: turn.correction ?? null,
      event: turn.event ?? null,
      left: turn.leagues_left,
      arrival: turn.arrival ?? null,
      agreed,
      note: turn.note ?? null,
      chosen: turn.chosen ?? null,
      press: duePress(turn, campaign),
      inventory: canon.holdings(EXPLORER),
      load: sheet.load(campaign),
      others: canon.holdingsAt(campaign.location),
      quests: campaign.quests,
      now: worldclock.longStamp(campaign.time),
      sent: ledger(campaign),
      standing: campaign.fight ?? null,
    }),
    {
      system: prompts.GM_SYSTEM(),
      tools: READ_TOOLS,
      permission: sqliteGate({ also: ["tesbota kill", "tesbota traits", "tesbota around", "tesbota route"] }),
      session: campaign.sessions.gm,
      model: MODELS.gm,
    }
  );
  campaign.sessions.gm = session;

  const said = extractJson(text, Written);
  const draft = Draft.parse({
    ...said,
    claims: [],
    destination: said.destination ?? turn.arrival ?? turn.destination ?? campaign.location ?? null,
    ...(agreed ? { minutes: agreed.minutes, fatigue: agreed.fatigue } : {}),
  });
  turn.draft = draft;
  const world = (turn.arrival || turn.event) && !turn.action;
  gmPhase(turn, world ? "world" : "outcome", draft.narration);
  turn.correction = null;

  if ((draft.fight || campaign.fight) && !turn.fight?.blows.length) {
    const opened = fight.openFight(campaign, draft);
    turn.fight = opened;
    // The page draws whatever is on the turn, so the fight goes on the turn the
    // moment it is declared. Waiting for the last blow means nobody sees any of it.
    showFight(turn, opened);
    return "declares";
  }
  return "narrated";
};

/**
 * Keep the drawn phase pointing at the fight as it stands. Saving and loading the
 * turn parts the two copies, so this re-marries them every blow.
 */
export function showFight(turn: TurnT, running: FightT): PhaseT {
  for (const entry of turn.phases) {
    if (entry.kind === "fight") {
      entry.fight = running;
      return entry;
    }
  }
  return gmPhase(turn, "fight", running.said, { fight: running });
}

// ── the lore masters ────────────────────────────────────────────────────────

const Facts = z.object({ facts: Listed(z.coerce.string()) });

const Ruled = z.object({
  claims: Listed(Written),
  bodies: Listed(z.object({
    declared: z.string().nullish(), is: z.string().nullish(), question: z.string().nullish(),
  })),
});

export function derived(ruled: Record<string, unknown>[]): [ClaimT[], VerdictT[]] {
  const claims: ClaimT[] = [];
  const verdicts: VerdictT[] = [];
  for (const entry of ruled) {
    const id = String(entry.id || `c${claims.length + 1}`);
    claims.push(Claim.parse({ id, text: String(entry.text || ""), entity: entry.entity ?? null, kind: entry.kind ?? null }));
    verdicts.push(Verdict.parse({
      claim: id,
      result: entry.result,
      why: entry.why || "",
      question: entry.question || "",
      alternative: entry.alternative || "",
      sources: entry.sources || [],
    }));
  }
  return [claims, verdicts];
}

/**
 * Lore 1: what the narration asserts about the world. It is handed the words and
 * nothing else — no canon, no tools — so it cannot quietly frame a fact to fit
 * what the record already holds.
 */
export async function readRecord(
  { campaign, turn }: World, narration: string, roster?: string | null
): Promise<string[]> {
  const [read] = await ask(
    prompts.lore1Turn(narration, {
      where: campaign.location_path,
      now: worldclock.longStamp(campaign.time),
      roster: roster ?? null,
      // The structured half of the draft goes the same way the prose does.
      did: prompts.doings(turn.draft, campaign.location) || null,
    }),
    { system: prompts.LORE1_SYSTEM(), tools: [], session: null, model: MODELS.lore1 }
  );
  const facts = extractJson(read, Facts).facts.map((f) => f.trim()).filter(Boolean);
  turn.facts = facts;
  return facts;
}

/**
 * Lore 2: the ruling. The only layer that reads canon, which is what splitting the
 * reading from the ruling was for.
 */
export async function ruleRecord(
  { campaign, turn }: World, narration: string, facts: string[],
  unknown?: Array<{ id: string; name: string }> | null
): Promise<[ClaimT[], VerdictT[], z.output<typeof Ruled>]> {
  const [text] = await ask(prompts.lore2Turn(narration, facts, unknown), {
    system: prompts.LORE2_SYSTEM(),
    tools: READ_TOOLS,
    permission: sqliteGate({ also: ["tesbota around", "tesbota route"] }),
    session: null,
    model: MODELS.lore2,
  });
  const ruled = extractJson(text, Ruled);
  const [claims, verdicts] = derived(ruled.claims);
  drafted(turn).claims = claims;

  const settled = new Set(campaign.settled.map((t) => canon.plain(t)));
  for (const verdict of verdicts) {
    const claim = claims.find((c) => c.id === verdict.claim);
    if (claim && settled.has(canon.plain(claim.text))) {
      verdict.result = "WITHIN_BOUNDS";
      verdict.why = "already ruled on";
    }
  }
  turn.verdicts = verdicts;
  return [claims, verdicts, ruled];
}

/** Nothing can go on until somebody writes the missing document. */
function hold({ campaign, turn }: World, gap: string): "unwritten" {
  turn.gap = gap;
  const blocked = openPhase(turn);
  if (blocked) blocked.status = "blocked";
  campaign.quiet = 0;
  return "unwritten";
}

const listed = (lines: string[]) => lines.map((line) => "- " + line).join("\n");

function holdForLore(world: World, claims: ClaimT[], unresolved: VerdictT[]): "unwritten" {
  const byId = new Map(claims.map((c) => [c.id, c]));
  return hold(world, listed(unresolved.map((v) => v.question.trim() || byId.get(v.claim)?.text || v.claim)));
}

function sendBack<E extends string>(world: World, wrong: VerdictT[], failed: string, edge: E): E | "unwritten" {
  const { turn } = world;
  if (turn.gm_retries >= MAX_GM_RETRIES) {
    return hold(world, `${failed}\n\n${JSON.stringify({ false: wrong }, null, 2)}`);
  }
  turn.gm_retries += 1;
  turn.correction = JSON.stringify({ contradicts_the_record: wrong }, null, 2);
  return edge;
}

/**
 * The whole of the lore master's part in a fight. Everything it puts on the ground
 * is ruled on once, here, before a die is thrown — after this the fight belongs to
 * the game master and nobody checks a blow.
 */
export const stepMuster: Step<"muster"> = async (world) => {
  const { turn } = world;
  const running = fightOf(turn);
  const strangers = fight.unbound(running).map((x) => ({ id: x.id, name: x.name }));
  const said = running.said;
  const facts = await readRecord(world, said, prompts.muster(running));
  const [claims, verdicts, ruled] = await ruleRecord(
    world, said, facts, strangers.length ? strangers : null
  );

  const asked: string[] = [];
  for (const bound of ruled.bodies) {
    const declared = canon.slug(bound.declared);
    const became = canon.slug(bound.is);
    if (became && canon.called(became) && fight.rebind(running, declared, became)) continue;
    const was = strangers.find((x) => x.id === declared)?.name || declared;
    asked.push(bound.question?.trim() || `does ${was} exist, and what is it`);
  }
  for (const stray of fight.unbound(running)) {
    if (!strangers.some((x) => x.id === stray.id)) continue;
    if (!asked.some((q) => q.includes(stray.name) || q.includes(stray.id))) {
      asked.push(`does ${stray.name} exist, and what is it`);
    }
  }
  showFight(turn, running);
  if (asked.length) return hold(world, listed(asked));

  const unresolved = verdicts.filter((v) => v.result === "UNRESOLVED");
  if (unresolved.length) return holdForLore(world, claims, unresolved);

  const wrong = verdicts.filter((v) => v.result === "FALSE");
  if (wrong.length) {
    const edge = sendBack(
      world, wrong, "The game master could not declare a fight that survives adjudication.", "rejected"
    );
    if (edge === "rejected") {
      turn.fight = null;
      turn.phases = turn.phases.filter((x) => x.kind !== "fight");
    }
    return edge;
  }

  turn.correction = null;
  return "mustered";
};

export const FATE_INSTRUCTIONS: Record<string, string> = {
  greater_calamity:
    "The dice have gone hard against them. Renarrate this same action, but " +
    "something goes badly and lastingly wrong in the doing of it — a real injury, " +
    "something lost or broken beyond mending, something dangerous arriving. Do not " +
    "soften it and do not undo the action.",
  lesser_calamity:
    "The dice have gone against them. Renarrate this same action, but it goes " +
    "wrong in a small way — a setback, a fumble, time or effort spent for nothing, " +
    "a minor hurt. It should sting, not maim. Do not undo the action.",
  lesser_fortune:
    "The dice have favoured them a little. Renarrate this same action, but " +
    "something small goes better than it had any right to — a thing noticed that " +
    "would have been missed, an easier way, a stroke of ordinary luck.",
  greater_fortune:
    "The dice have favoured them greatly. Renarrate this same action, but " +
    "something genuinely lucky happens in the doing of it — a real find, an " +
    "unlooked-for kindness, a danger that passes them by entirely. Let it matter.",
};

export function rollCheck({ campaign, turn }: World, rng: Rng = random): CheckT | null {
  const asked = turn.draft?.check;
  const skill = String(asked?.skill || "").trim().toLowerCase();
  const bonus = sheet.skillBonus(campaign, skill);
  if (bonus === null) return null;
  const dc = asked?.dc || 10;
  const { fatigue, hunger } = campaign.vitals;
  const against = ([["spent", fatigue], ["starving", hunger]] as const)
    .filter(([, level]) => level >= 100)
    .map(([word]) => word);
  const rolls = Array.from({ length: 1 + against.length }, () => rng.int(1, SKILL_DIE));
  const roll = Math.min(...rolls);
  const outcome = {
    skill, dc, roll, rolls, against, for: [], bonus,
    total: roll + bonus,
    passed: roll + bonus >= dc,
  };
  turn.check = outcome;
  return outcome;
}

export function rollFate(turn: TurnT, rng: Rng = random): string | null {
  const roll = rng.int(1, DIE);
  turn.roll = roll;
  turn.rolled = true;
  let fate: string | null = null;
  if (roll <= 1) fate = "greater_calamity";
  else if (roll <= 2) fate = "lesser_calamity";
  else if (roll > DIE - 1) fate = "greater_fortune";
  else if (roll > DIE - 2) fate = "lesser_fortune";
  turn.fate = fate;
  return fate;
}

/**
 * Mid-fight this is nonsense — nobody stops swinging to be told they are weary —
 * so a draft carrying a fight is never sent back for it.
 */
export function tooTired(campaign: CampaignT, draft: DraftT): boolean {
  if (draft.fight) return false;
  return campaign.vitals.fatigue + draft.fatigue > MAX_FATIGUE;
}

/**
 * Where a rejected draft goes back to: an answer to be answered again, anything
 * else to the game master. A rolled fight never comes here — it was checked at its
 * muster, and its dice are not the lore master's to overturn.
 */
export const redraftEdge = (turn: TurnT) => (turn.looking ? "reanswer" : "redraft");

/** Lore 1 alone: read the world out of it, then hand the facts to the ruling. */
export const stepLore1: Step<"lore1"> = async (world) => {
  await readRecord(world, drafted(world.turn).narration);
  return "read";
};

/** Lore 2 alone: rule on what lore 1 read, and decide where the draft goes. */
export const stepLore2: Step<"lore2"> = async (world) => {
  const { campaign, turn } = world;
  const draft = drafted(turn);
  const narration = draft.narration;
  const [claims, verdicts] = await ruleRecord(world, narration, turn.facts);

  const wrong = verdicts.filter((v) => v.result === "FALSE");
  const unresolved = verdicts.filter((v) => v.result === "UNRESOLVED");

  if (unresolved.length) return holdForLore(world, claims, unresolved);

  if (tooTired(campaign, draft) && !turn.fate && turn.gm_retries < MAX_GM_RETRIES) {
    turn.gm_retries += 1;
    turn.correction = JSON.stringify({
      too_tired: {
        fatigue_now: campaign.vitals.fatigue,
        this_action_would_add: draft.fatigue,
        maximum: MAX_FATIGUE,
      },
      instruction:
        "They are too worn out to do this. Do not narrate them doing it. " +
        "Narrate that they cannot, and what resting here would take.",
    }, null, 2);
    return redraftEdge(turn);
  }

  if (!wrong.length && !turn.rolled && !turn.looking) {
    const check = rollCheck(world);
    const fate = rollFate(turn);
    const payload: Record<string, unknown> = {};

    if (check && !check.passed) {
      payload.failed_check = check;
      payload.check_instruction =
        `They tried and fell short: a ${check.skill} check, rolled ` +
        `${check.roll} plus ${check.bonus >= 0 ? "+" : ""}${check.bonus} against a difficulty of ` +
        `${check.dc}` +
        (check.against.length
          ? `, worst of ${check.rolls.length} because they are ${check.against.join(" and ")}`
          : "") +
        ". Renarrate the same attempt not working. They may try " +
        "something else afterwards, but this attempt failed.";
    } else if (check) {
      payload.passed_check = check;
    }

    if (fate) {
      payload.fate = fate;
      payload.rolled = turn.roll;
      payload.die = DIE;
      payload.fate_instruction = FATE_INSTRUCTIONS[fate];
    }

    if ("failed_check" in payload || fate) {
      turn.correction = JSON.stringify(payload, null, 2);
      return redraftEdge(turn);
    }
  }

  if (wrong.length) {
    return sendBack(
      world, wrong, "The game master could not produce a draft that survives adjudication.", redraftEdge(turn)
    );
  }
  return "stands";
};

// ── the fight ───────────────────────────────────────────────────────────────

/**
 * One word back from the explorer, read the way an action is read. Anything that
 * does not parse is a swing, because a body in a fight does not stand still.
 */
export function chosenBlow(said: string, campaign: CampaignT, running?: FightT | null): SwingT {
  const first = String(said ?? "").trim().split("\n");
  const head = (first[0] || "").trim().replace(/^["'`*]+|["'`*]+$/g, "").trim();
  const upper = head.toUpperCase();
  if (upper.startsWith("FLEE")) return { verb: "FLEE" };
  if (upper.startsWith("ITEM")) {
    const want = canon.slug(head.slice(4));
    const found = fight.usable(campaign).find((h) => canon.slug(h.name) === want);
    return found ? { verb: "ITEM", item: found.item } : { verb: "ATTACK" };
  }
  if (upper.startsWith("SKILL")) {
    const name = head.slice(5).split(/\s+/).filter(Boolean).join(" ").toLowerCase().replace(/^[:\- ]+|[:\- ]+$/g, "");
    if (sheet.skillBonus(campaign, name) !== null) {
      return { verb: "SKILL", skill: name, mark: aimed(head, running) };
    }
  }
  return { verb: "ATTACK", mark: aimed(head, running) };
}

/**
 * `ATTACK the rat mother` picks its mark, and picks it by id. Naming nobody leaves
 * the choosing to the driver, which goes for whoever is closest to dropping.
 */
export function aimed(head: string, running?: FightT | null): string | null {
  if (!running) return null;
  const rest = head.split(/\s+/).slice(1).join(" ");
  const want = canon.slug(rest);
  if (!want) return null;
  const found = running.them.find(
    (x) => !x.dead && (x.id === want || canon.slug(x.name) === want)
  );
  return found ? found.id : null;
}

/** The one line the explorer is handed before being asked again. */
export function saidBlow(blow: BlowT): string {
  const who = blow.name || "somebody";
  if (blow.chose === "ASLEEP") return `${who} does not stir.`;
  if (blow.spawned) return `${who} ${blow.chose} — ${blow.spawned} is on you as well.`;
  if (blow.side === "us" && String(blow.chose || "").startsWith("ITEM")) {
    return `${who} used the ${String(blow.chose).slice(5)}.`;
  }
  if (blow.chose === "FLEE") {
    return blow.hit ? `${who} broke away.` : `${who} tried to break away and could not.`;
  }
  const mark = blow.atname || "nobody";
  if (blow.hit) {
    const hurt = blow.dealt || blow.taken || 0;
    return `${who} hit ${mark} for ${hurt}.`;
  }
  return `${who} swung at ${mark} and missed.`;
}

/** Ask them what they do with this turn of theirs. One line out, one word back. */
export const stepSwing: Step<"swing"> = async ({ campaign, turn }) => {
  const running = fightOf(turn);
  const me = running.us[0];
  const first = !running.blows.length;
  const message = first
    ? prompts.fightOpen(running, me, fight.usable(campaign))
    : prompts.fightBlow(running, me, saidBlow(running.blows[running.blows.length - 1]));
  const [text, session] = await ask(message, {
    system: prompts.EXPLORER_SYSTEM(),
    tools: ["Bash"],
    session: campaign.sessions.explorer,
    model: MODELS.explorer,
    permission: explorerPermission,
  });
  campaign.sessions.explorer = session;
  turn.swing = chosenBlow(firstUtterance(text) || text, campaign, running);
  return "chose";
};

/** The explorer's turn, spent the way they said to spend it. */
export function takeTurn(
  world: World, running: FightT, me: FighterT, blow: BlowT, rng: Rng
) {
  const picked: SwingT = world.turn.swing ?? { verb: "ATTACK" };
  blow.chose = picked.verb;

  if (picked.verb === "ITEM") {
    const used = fight.usable(world.campaign).find((h) => h.item === picked.item);
    if (used) {
      blow.chose = `ITEM ${used.name}`;
      blow.mended = canon.does(used.effects);
      world.turn.spent.push(used.name);
      me.health = Math.min(me.most, me.health + fight.mended(blow, "health"));
      blow.left = me.health;
      return;
    }
    blow.chose = "ATTACK";
  }

  if (picked.verb === "FLEE") {
    const [check] = strike(world, running, me, null, me.skill ?? null, running.flee_dc, rng);
    blow.check = check;
    blow.hit = check.passed;
    if (check.passed) running.ended = "fled";
    return;
  }

  const skill = picked.verb === "SKILL" ? picked.skill : me.skill ?? null;
  if (picked.verb === "SKILL") blow.chose = `SKILL ${picked.skill}`;
  const mark = fight.stillUp(running, "mark" in picked ? picked.mark : null) || fight.marks(running, me);
  if (!mark) return;
  const [check, hurt] = strike(world, running, me, mark, skill, mark.dc, rng);
  blow.check = check;
  blow.hit = check.passed;
  blow.at = mark.id;
  blow.atname = mark.name;
  fight.wound(running, mark, hurt, blow);
}

/**
 * One swing. The driver rolls; nobody argues with it. `edge` throws two dice and
 * keeps the better, which is the one thing a body can have going for it.
 */
export function strike(
  world: World | null, running: FightT, who: FighterT, mark: FighterT | null,
  skill: string | null, dc: number, rng: Rng, edge = false, hurts?: string | null
): [CheckT, number] {
  let check: CheckT | null;
  if (who.kind === "explorer" && world) {
    drafted(world.turn).check = { skill: skill ?? "", dc };
    check = rollCheck(world, rng);
    if (check === null) {
      const roll = rng.int(1, SKILL_DIE);
      check = {
        skill: skill ?? "", dc, roll, rolls: [roll], against: [], for: [], bonus: who.bonus,
        total: roll + who.bonus, passed: roll + who.bonus >= dc,
      };
    }
  } else {
    const rolls = Array.from({ length: edge ? 2 : 1 }, () => rng.int(1, SKILL_DIE));
    const roll = edge ? Math.max(...rolls) : rolls[0];
    check = {
      skill: skill || "a swing", dc, roll, rolls,
      for: edge ? ["the better of two"] : [],
      against: [], bonus: who.bonus, total: roll + who.bonus,
      passed: roll + who.bonus >= dc,
    };
  }
  const bandOf = hurts || who.damage;
  let hurt = 0;
  if (check.passed) {
    hurt = fight.band(bandOf, rng);
    if (check.roll === SKILL_DIE) hurt += fight.band(bandOf, rng);
  }
  return [check, hurt];
}

/** Whoever's turn it is takes it. The explorer is asked; everybody else is rolled. */
export const stepFight: Step<"fight"> = async (world, rng = random) => {
  const { turn } = world;
  const running = fightOf(turn);
  const who = fight.whoseTurn(running);
  if (who === null) {
    running.ended = running.ended || "beaten";
    return "over";
  }

  if (who.kind === "explorer" && turn.swing == null) return "theirs";

  const blow = Blow.parse({
    n: running.blows.length + 1,
    round: running.round,
    who: who.id,
    name: who.name,
    side: who.kind !== "foe" ? "us" : "them",
    chose: "ATTACK",
    hit: false,
    dealt: 0,
    taken: 0,
    check: null,
    text: "",
  });

  if (who.asleep > 0) {
    who.asleep -= 1;
    blow.chose = "ASLEEP";
    blow.spent = true;
  } else if (who.kind === "explorer") {
    takeTurn(world, running, who, blow, rng);
  } else if (fight.ready(who) && who.ability?.spawn) {
    const power = who.ability;
    const called = who.ability.spawn;
    const wait = Math.trunc(Number(power.delay) || 0);
    blow.chose = String(power.name || "spawns");
    if (wait) {
      running.owed.push({ at: running.round + wait, spawn: called, by: who.name });
      blow.calling = `${called.name} x${called.count || 1}`;
    } else {
      blow.spawned = fight.spawn(running, called).map((x) => x.name).join(", ");
    }
    who.asleep = Math.trunc(Number(power.sleep) || 0);
    who.cool = Math.trunc(Number(power.cooldown) || 0);
    power.used = true;
  } else {
    who.cool = Math.max(0, Math.trunc(Number(who.cool) || 0) - 1);
    const power = fight.ready(who) && who.ability ? who.ability : null;
    const mark = fight.marks(running, who);
    if (mark) {
      const [check, hurt] = strike(
        null, running, who, mark, who.skill ?? null, mark.dc, rng,
        !!power?.advantage, power?.damage
      );
      blow.check = check;
      blow.hit = check.passed;
      blow.at = mark.id;
      blow.atname = mark.name;
      if (power) {
        blow.chose = String(power.name || "its best");
        who.cool = Math.trunc(Number(power.cooldown) || 0);
        who.asleep = Math.trunc(Number(power.sleep) || 0);
      }
      fight.wound(running, mark, hurt, blow);
    }
  }

  running.blows.push(blow);
  showFight(turn, running);
  turn.swing = null;
  running.turn += 1;
  if (running.turn >= fight.order(running).length) {
    running.turn = 0;
    running.round += 1;
    fight.arrive(running);
  }

  blow.us = fight.snapshot(running.us);
  blow.them = fight.snapshot(running.them);

  fight.settle(running);
  if (!running.ended && running.blows.length >= MAX_BLOWS) running.ended = "broken";
  return running.ended ? "over" : "next";
};

const Worded = Draft.pick({
  destination: true, transactions: true, quest_open: true, quest_update: true, quest_close: true,
}).extend({ blows: Listed(z.coerce.string()) });

/** One game master call to put words on a settled exchange. */
export const stepBlows: Step<"blows"> = async ({ campaign, turn }) => {
  const running = fightOf(turn);
  if (!turn.rolled) rollFate(turn);
  const [text, session] = await ask(
    prompts.gmBlows(running, turn.chosen),
    {
      system: prompts.GM_SYSTEM(),
      tools: READ_TOOLS,
      permission: sqliteGate({ also: ["tesbota kill", "tesbota traits", "tesbota around", "tesbota route"] }),
      session: campaign.sessions.gm,
      model: MODELS.gm,
    }
  );
  campaign.sessions.gm = session;
  const out = extractJson(text, Worded);
  const lines = out.blows.map((x) => x.trim()).filter(Boolean);
  running.blows.forEach((blow, n) => {
    if (lines[n] !== undefined) blow.text = lines[n];
  });

  // The book keeps the whole of it; the page above the fight shows one line at a
  // time, and takes them from the blows themselves.
  const was = drafted(turn);
  const me = running.us[0];
  const mine = running.blows.filter((b) => b.side === "us" && b.who === me.id).length;
  const sated = running.blows.reduce((a, b) => a + fight.mended(b, "hunger"), 0);
  const draft: DraftT = {
    ...was,
    narration: [running.said, ...lines].filter(Boolean).join("\n\n").trim(),
    destination: out.destination || was.destination,
    transactions: [
      ...was.transactions,
      ...out.transactions,
      ...turn.spent.map((name) => ({ from: EXPLORER, to: GODHEAD_ID, name, qty: 1 })),
    ],
    quest_open: [...was.quest_open, ...out.quest_open],
    quest_update: [...was.quest_update, ...out.quest_update],
    quest_close: [...was.quest_close, ...out.quest_close],
    minutes: Math.max(2, running.round * BLOW_MINUTES),
    fatigue: mine * BLOW_FATIGUE,
    health: me.most ? me.health - me.most : 0,
    hunger: sated || null,
    check: null,
  };
  turn.draft = draft;
  turn.check = null;

  const told = showFight(turn, running);
  told.text = draft.narration;
  told.status = "pending";
  // The record was checked when the fight was declared. Swinging is the game
  // master's alone — every blow is a particular, and particulars are never the
  // lore master's to rule on.
  return "written";
};

// ── delivery ────────────────────────────────────────────────────────────────

export function applyVitals(campaign: CampaignT, draft: DraftT): CampaignT {
  const vitals = campaign.vitals;
  vitals.fatigue = Math.max(0, Math.min(MAX_FATIGUE, vitals.fatigue + draft.fatigue));
  vitals.health = Math.max(0, Math.min(MAX_HEALTH, vitals.health + draft.health));

  const drift = (draft.minutes / 60) * HUNGER_PER_HOUR;
  vitals.hunger = Math.max(0, Math.min(MAX_HUNGER, Math.round(vitals.hunger + (draft.hunger ?? drift))));
  return campaign;
}

/**
 * One ledger. `the-godhead` on either side is the world itself — where bread eaten
 * goes, and where a coin found in the mud comes from.
 */
export function applyInventory(draft: DraftT, turnId?: string | null) {
  for (const entry of draft.transactions) {
    if (!entry.name) continue;
    const src = canon.slug(entry.from);
    const dst = canon.slug(entry.to);
    canon.transfer(
      src === "" || src === GODHEAD_ID ? null : src,
      dst === "" || dst === GODHEAD_ID ? null : dst,
      entry.name,
      entry.qty,
      turnId
    );
  }
}

const CLOSED = QuestStatus.exclude(["active"]);

/**
 * A new errand gets a shape before the game master ever plays it. Nothing here is
 * canon: it is ideation, and the walls it runs into are the point.
 */
export async function scriptFor(quest: QuestT, campaign: CampaignT): Promise<string> {
  try {
    const [text] = await ask(prompts.questmasterTurn(quest, campaign.location_path), {
      system: prompts.QUESTMASTER_SYSTEM(),
      tools: READ_TOOLS,
      permission: sqliteGate({ also: ["tesbota around", "tesbota route"] }),
      session: null,
      model: MODELS.questmaster,
    });
    return String(extractJson(text, Written).script || "").trim();
  } catch (exc) {
    return `the questmaster fell over: ${(exc as Error).name}: ${exc}`.slice(0, 400);
  }
}

export async function applyQuests(campaign: CampaignT, draft: DraftT, turnId: string) {
  const quests = campaign.quests;
  const byId = new Map(quests.map((q) => [q.id, q]));

  for (const item of draft.quest_open) {
    const entry = Written.safeParse(item).data;
    if (!entry?.id) continue;
    const ident = canon.slug(String(entry.id));
    if (byId.has(ident)) continue;
    const quest: QuestT = {
      id: ident,
      at: worldclock.stamp(campaign.time),
      title: String(entry.title || ident.replace(/-/g, " ")),
      detail: String(entry.detail || ""),
      giver: String(entry.giver || ""),
      status: "active",
      opened: turnId,
      closed: null,
      where: [...campaign.location_path],
      script: "",
    };
    quest.script = await scriptFor(quest, campaign);
    quests.push(quest);
    byId.set(ident, quest);
  }

  for (const item of draft.quest_update) {
    const entry = Written.safeParse(item).data;
    if (!entry) continue;
    const quest = byId.get(canon.slug(String(entry.id || "")));
    if (!quest || quest.status !== "active") continue;
    if (entry.detail) quest.detail = String(entry.detail);
  }

  for (const item of draft.quest_close) {
    const entry = item && typeof item === "object" ? Written.safeParse(item).data ?? {} : null;
    const ident = entry ? canon.slug(String(entry.id || "")) : canon.slug(String(item));
    const outcome = entry ? String(entry.outcome || "done").toLowerCase() : "done";
    const quest = byId.get(ident);
    if (!quest || quest.status !== "active") continue;
    quest.status = CLOSED.safeParse(outcome).data ?? "done";
    quest.closed = turnId;
    quest.closed_at = worldclock.stamp(campaign.time);
  }
  return campaign;
}

/**
 * A fight that outran the guard is carried with everybody's wounds on them. Any
 * other ending closes it. Nought health kills, which nothing in this machine did
 * before a fight could take you there.
 */
export function settleFight(campaign: CampaignT, turn: TurnT): CampaignT {
  const running = turn.fight;
  if (!running) return campaign;
  if (running.ended === "broken") {
    campaign.fight = {
      skill: running.skill,
      flee_dc: running.flee_dc,
      name: running.name,
      us: running.us.slice(1).filter((x) => !x.dead).map((x) => ({ ...x })),
      them: running.them.filter((x) => !x.dead).map((x) => ({ ...x })),
    };
  } else {
    campaign.fight = null;
  }
  if (running.ended === "killed" && !pendingDeath()) {
    const felled = [...running.blows].reverse()
      .find((b) => b.side === "them" && b.taken)?.name || running.name;
    recordDeath(`killed by ${felled}`);
  }
  return campaign;
}

/**
 * Everything a turn changes about the world, applied in one place. Nothing above
 * it writes to the campaign, so a turn that never reaches here leaves no mark —
 * which is what makes a rejected draft safe to throw away.
 */
export const stepDeliver: Step<"deliver"> = async ({ campaign, turn }) => {
  if (turn.delivered) return "again";

  const draft = drafted(turn);

  applyVitals(campaign, draft);
  applyInventory(draft, turn.turn_id);
  await applyQuests(campaign, draft, turn.turn_id);
  settleFight(campaign, turn);

  const heading = canon.slug(draft.destination);
  const where = turn.arrival ? turn.arrival : campaign.location ? "" : heading;
  if (where) {
    campaign.location = where;
    canon.ensureEntity("places", campaign.location, null, turn.turn_id);
    campaign.location_path = canon.ancestry(campaign.location);
  }

  const time = worldclock.advance(campaign.time, draft.minutes);
  time.stamp = worldclock.stamp(time);
  time.long = worldclock.longStamp(time);
  campaign.time = time;
  turn.at = time.long;
  campaign.last_narration = draft.narration;

  const byVerdict = new Map(turn.verdicts.map((v) => [v.claim, v]));
  let current = openPhase(turn);
  if (current === null && draft.narration) current = phase(turn, "gm", "world", draft.narration);
  if (current) {
    current.status = "checked";
    current.claims = draft.claims.map((claim) => ({
      ...claim, verdict: byVerdict.get(claim.id) ?? null,
    }));
    if (current.kind === "outcome" || current.kind === "world") {
      current.minutes = draft.minutes;
      current.fatigue = draft.fatigue;
      current.roll = turn.roll;
      current.outcomes = turn.outcomes;
      current.chosen = turn.chosen;
      current.fortune = turn.fortune;
      current.check = turn.check;
    }
  }
  turn.location_path = campaign.location_path;
  turn.vitals = { ...campaign.vitals };
  const active = campaign.quests.find((q) => q.status === "active");
  turn.quest = active ? active.title : null;

  const clear = () => {
    turn.draft = null;
    turn.verdicts = [];
    turn.gm_retries = 0;
  };

  if (turn.looking) {
    const asked = { question: turn.question, answer: draft.narration };
    if (turn.mode === "say") turn.talks.push(asked);
    else if (turn.mode === "look") turn.looks.push(asked);
    else turn.context.push(asked);
    turn.looking = false;
    turn.mode = null;
    turn.question = null;
    clear();
    return "spent";
  }

  turn.destination = heading || campaign.location || null;

  if ((turn.arrival || turn.event) && !turn.action) {
    turn.minutes = draft.minutes;
    clear();
    return "spent";
  }

  turn.minutes = draft.minutes;
  campaign.quiet = (campaign.quiet || 0) + 1;
  campaign.calm = turn.pressed ? 0 : (campaign.calm || 0) + 1;
  turn.resolved = true;
  clear();
  return "spent";
};

/** The handler for each state. The edges they may return are in `machine.ts`. */
export const STEPS: { [S in LoopState]: Step<S> } = {
  explorer: stepExplorer,
  answer: stepAnswer,
  propose: stepPropose,
  gm: stepGm,
  muster: stepMuster,
  swing: stepSwing,
  fight: stepFight,
  blows: stepBlows,
  lore1: stepLore1,
  lore2: stepLore2,
  deliver: stepDeliver,
  narrate: stepNarrate,
};

export { AgentError };
