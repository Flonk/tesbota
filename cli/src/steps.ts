/**
 * The transitions, one function each.
 *
 * A step is handed the world, changes it, and returns the name of the edge it is
 * taking. It never says what state comes next — `machine.ts` owns that, and an
 * edge that is not declared there cannot be taken. This is the whole of the
 * difference from what came before, where thirty-eight scattered assignments
 * decided the shape of the machine between them and nothing could be read off.
 */

import * as canon from "./canon.ts";
import * as chronicle from "./chronicle.ts";
import * as fight from "./fight.ts";
import * as prompts from "./prompts.ts";
import * as sheet from "./sheet.ts";
import * as worldclock from "./worldclock.ts";
import { AgentError, ask, extractJson } from "./agent.ts";
import { sqliteGate } from "./gate.ts";
import { random, type Rng } from "./rng.ts";
import { explorerName, pendingDeath, recordDeath } from "./state.ts";
import type { CampaignT, TurnT } from "./schema.ts";
import {
  BANDS, BLOW_FATIGUE, BLOW_MINUTES, DIE, EXPLORER, GODHEAD_ID, HUNGER_PER_HOUR,
  MAX_ASKS, MAX_BLOWS, MAX_FATIGUE, MAX_GM_RETRIES, MAX_HEALTH, MAX_HUNGER,
  MAX_LOOKS, MAX_TALKS, MODELS, OPENING, PRESS_FLOOR, READ_TOOLS, SKILL_DIE,
  SPARK_FLOOR, TRIVIAL_FATIGUE, TRIVIAL_MINUTES, WEIGHT,
} from "./config.ts";

/** What a step is handed, and the only thing it is handed. */
export type World = { campaign: CampaignT; turn: TurnT };

/** What a step gives back: the name of one edge out of the state it was in. */
export type Step = (world: World, rng?: Rng) => Promise<string> | string;

const T = (turn: TurnT) => turn as unknown as Record<string, any>;
const C = (campaign: CampaignT) => campaign as unknown as Record<string, any>;

// ── phases ──────────────────────────────────────────────────────────────────

export function phase(turn: TurnT, who: string, kind: string, text: string, extra: Record<string, any> = {}) {
  const entries = (T(turn).phases ||= []);
  const entry = {
    n: entries.length + 1,
    who,
    kind,
    text,
    status: who === "explorer" ? "said" : "pending",
    claims: [],
    ...extra,
  };
  entries.push(entry);
  return entry;
}

/**
 * Append what the game master said. A pending phase is rewritten in place — that
 * only happens when the lore master has sent it back.
 */
export function gmPhase(turn: TurnT, kind: string, text: string, extra: Record<string, any> = {}) {
  const entries = (T(turn).phases ||= []);
  const last = entries[entries.length - 1];
  if (last && last.who === "gm" && last.status === "pending") {
    last.kind = kind;
    last.text = text;
    last.redrafts = (last.redrafts || 0) + 1;
    Object.assign(last, extra);
    return last;
  }
  return phase(turn, "gm", kind, text, extra);
}

export function openPhase(turn: TurnT) {
  const entries = T(turn).phases || [];
  const last = entries[entries.length - 1];
  return last && last.who === "gm" && last.status === "pending" ? last : null;
}

// ── the explorer ────────────────────────────────────────────────────────────

const EXPLORER_COMMANDS = ["tesbota stats", "tesbota inventory", "tesbota quests"];

export function normaliseCommand(text: string): string {
  let parts = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts[0] === "uv" && parts[1] === "run") parts = parts.slice(2);
  return parts.join(" ");
}

export const explorerPermission = async (toolName: string, toolInput: Record<string, unknown>) => {
  if (toolName !== "Bash") {
    return {
      behavior: "deny" as const,
      message: "You have no such power. You may run tesbota stats, tesbota inventory or tesbota quests.",
    };
  }
  const raw = String((toolInput as any)?.command ?? "");
  if ([...";|&$`><\n"].some((ch) => raw.includes(ch))) {
    return { behavior: "deny" as const, message: "Nothing happens." };
  }
  if (EXPLORER_COMMANDS.includes(normaliseCommand(raw))) return { behavior: "allow" as const };
  return {
    behavior: "deny" as const,
    message:
      "Nothing happens. The only things you can do are `tesbota stats`, " +
      "`tesbota inventory` and `tesbota quests`.",
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
export function classify(text: string, turn: TurnT): [string, string] {
  const stripped = unprefixed(text);
  const upper = stripped.toUpperCase();

  if (upper.startsWith("LOOK:")) return ["look", stripped.slice(5).trim()];
  if (upper.startsWith("SAY:")) return ["say", stripped.slice(4).trim()];

  const bare = stripped.toLowerCase().replace(/^[.!… ]+|[.!… ]+$/g, "");
  if (DONE_WORDS.some((w) => bare === w || bare.startsWith(w + " ") || bare.startsWith("i am " + w))) {
    return ["done", stripped];
  }
  if (bare.length <= 48 && DONE_WORDS.some((w) => bare.includes(w))) return ["done", stripped];

  const looksLeft = (T(turn).looks || []).length < MAX_LOOKS;
  const talksLeft = (T(turn).talks || []).length < MAX_TALKS;

  if (QUOTES.includes(stripped.slice(0, 1)) && talksLeft) {
    return ["say", stripped.replace(new RegExp(`^[${QUOTES}”’»]+|[${QUOTES}”’»]+$`, "g"), "")];
  }
  if (stripped.endsWith("?")) {
    if (looksLeft) return ["look", stripped];
    if (talksLeft) return ["say", stripped];
  }
  return ["done", stripped];
}

export const stepExplorer: Step = async ({ campaign, turn }) => {
  const [text, session] = await ask(
    prompts.explorerTurn(campaign.last_narration ?? null, T(turn).nudge, turn.check),
    {
      system: prompts.EXPLORER_SYSTEM(),
      tools: ["Bash"],
      session: (campaign.sessions as any).explorer,
      model: MODELS.explorer,
      permission: explorerPermission as any,
    }
  );
  (campaign.sessions as any).explorer = session;

  const stripped = firstUtterance(text);
  const upper = stripped.toUpperCase();
  const asked = upper.startsWith("LOOK:") || upper.startsWith("SAY:");

  if (!stripped) {
    T(turn).blank = (T(turn).blank || 0) + 1;
    if (T(turn).blank >= MAX_ASKS) {
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
    T(turn).nudge = (T(turn).nudge || 0) + 1;
    if (T(turn).nudge < MAX_ASKS) return "again";
    turn.action = stripped.split(":").slice(1).join(":").trim();
    phase(turn, "explorer", "action", turn.action);
    return "acts";
  }

  const [kind, said] = classify(stripped, turn);
  const caps: Record<string, number> = { look: MAX_LOOKS, say: MAX_TALKS };
  const buckets: Record<string, string> = { look: "looks", say: "talks" };

  if (caps[kind] !== undefined && (T(turn)[buckets[kind]] || []).length < caps[kind]) {
    turn.question = said;
    turn.mode = kind as any;
    turn.looking = true;
    phase(turn, "explorer", kind, said);
    return "looks";
  }

  T(turn).ready = said;
  if (turn.resolved) {
    turn.delivered = true;
    return "quiet";
  }
  return "acts";
};

/** The turn is over and it survived adjudication. It is set down as it stands. */
export const stepNarrate: Step = ({ turn }) => {
  if (chronicle.played(turn)) {
    const written = chronicle.write(turn);
    if (written.length) T(turn).chronicle = [...(T(turn).chronicle || []), ...written];
  }
  return "written";
};

/**
 * What the game master's session has already been handed. A session that has gone
 * means it has been handed nothing, so the slate goes with it.
 */
export function ledger(campaign: CampaignT): Record<string, string> {
  if (!(campaign.sessions as any).gm) C(campaign).sent = {};
  return (C(campaign).sent ||= {});
}

export const stepAnswer: Step = async ({ campaign, turn }) => {
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
      session: (campaign.sessions as any).gm,
      model: MODELS.gm,
    }
  );
  (campaign.sessions as any).gm = session;
  const draft = extractJson<Record<string, any>>(text);
  draft.claims ??= [];
  draft.travel = null;
  draft.minutes = 0;
  draft.fatigue = 0;
  draft.health = 0;
  draft.check = null;
  T(turn).draft = draft;
  gmPhase(turn, "answer", draft.narration);
  turn.correction = null;
  return "answered";
};

/**
 * Six ways it could go, one to a band up the ladder, weights made to add up. A
 * malformed table is thrown away; a missing weight falls back to its band.
 */
export function weighOutcomes(raw: any[] | null | undefined) {
  const entries = (raw || []).filter((e) => e && typeof e === "object" && String(e.text || "").trim());
  const kept: any[] = [];
  const used = new Set<any>();
  for (const wanted of BANDS) {
    const match = entries.find((e) => e.band === wanted && !used.has(e));
    if (!match) return [];
    used.add(match);
    kept.push(match);
  }
  const out = kept.map((entry) => {
    let weight = Number(entry.p);
    if (!(weight > 0)) weight = WEIGHT[entry.band];
    return { band: entry.band as string, text: String(entry.text).trim(), p: weight };
  });
  const total = out.reduce((a, e) => a + e.p, 0);
  for (const entry of out) entry.p = entry.p / total;
  return out;
}

export function spin(outcomes: any[], fortune: number, only?: string | string[] | null) {
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

export const stepPropose: Step = async ({ campaign, turn }, rng = random) => {
  if (campaign.note && !turn.note) {
    turn.note = campaign.note;
    campaign.note = null;
  }

  const [text] = await ask(
    prompts.gmPropose(turn.action, {
      previous: campaign.last_narration ?? null,
      vitals: campaign.vitals,
      answers: turn.answers || [],
      note: turn.note ?? null,
      inventory: canon.holdings(EXPLORER),
      load: sheet.load(campaign),
      others: canon.holdingsAt(campaign.location),
      now: worldclock.longStamp(campaign.time as any),
    }),
    {
      system: prompts.GM_PROPOSE_SYSTEM(),
      tools: READ_TOOLS,
      permission: sqliteGate({ also: ["tesbota around", "tesbota route"] }),
      session: null,
      model: MODELS.gm,
    }
  );
  const out = extractJson<Record<string, any>>(text);

  const question = typeof out.ask === "string" ? out.ask.trim() : null;
  const answers = (T(turn).answers ||= []);
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

  let proposal = out.proposal;
  const priced = proposal && typeof proposal === "object" && "minutes" in proposal;

  if (!priced) {
    T(turn).propose_retries = (T(turn).propose_retries || 0) + 1;
    if (T(turn).propose_retries < 2) return "again";
    proposal = {
      summary: turn.action || "",
      target: null,
      minutes: TRIVIAL_MINUTES,
      fatigue: TRIVIAL_FATIGUE,
      unpriced: true,
    };
  }

  proposal.summary ??= turn.action || "";
  proposal.minutes = Math.trunc(Number(proposal.minutes) || 0);
  proposal.fatigue = Math.trunc(Number(proposal.fatigue) || 0);
  T(turn).proposal = proposal;

  const outcomes = weighOutcomes(out.outcomes);
  if (outcomes.length) {
    const strange = (campaign.quiet || 0) >= SPARK_FLOOR;
    T(turn).outcomes = outcomes;
    T(turn).fortune = rng.next();
    T(turn).chosen = spin(outcomes, T(turn).fortune, strange ? ["epic", "legendary"] : null);
    T(turn).forced_strange = strange;
  }

  T(turn).confirmed = true;
  return "priced";
};

export function duePress(turn: TurnT, campaign?: CampaignT | null): boolean {
  if (!("pressed" in T(turn))) T(turn).pressed = ((campaign as any)?.calm || 0) >= PRESS_FLOOR;
  return T(turn).pressed;
}

export const stepGm: Step = async ({ campaign, turn }) => {
  if (!(campaign.sessions as any).gm && !campaign.last_narration) {
    T(turn).draft = JSON.parse(JSON.stringify(OPENING));
    turn.opening = true;
    return "narrated";
  }

  const [text, session] = await ask(
    prompts.gmTurn(turn.action, {
      previous: campaign.last_narration ?? null,
      vitals: campaign.vitals,
      correction: turn.correction ?? null,
      event: turn.event ?? null,
      left: T(turn).leagues_left ?? null,
      arrival: turn.arrival ?? null,
      agreed: T(turn).confirmed ? T(turn).proposal : null,
      note: turn.note ?? null,
      chosen: T(turn).chosen ?? null,
      press: duePress(turn, campaign),
      inventory: canon.holdings(EXPLORER),
      load: sheet.load(campaign),
      others: canon.holdingsAt(campaign.location),
      quests: campaign.quests || [],
      now: worldclock.longStamp(campaign.time as any),
      sent: ledger(campaign),
      standing: campaign.fight ?? null,
    }),
    {
      system: prompts.GM_SYSTEM(),
      tools: READ_TOOLS,
      permission: sqliteGate({ also: ["tesbota kill", "tesbota traits", "tesbota around", "tesbota route"] }),
      session: (campaign.sessions as any).gm,
      model: MODELS.gm,
    }
  );
  (campaign.sessions as any).gm = session;

  const draft = extractJson<Record<string, any>>(text);
  draft.claims ??= [];
  draft.travel ??= null;
  draft.minutes ??= 0;
  draft.fatigue ??= 0;
  draft.health ??= 0;
  draft.hunger ??= null;
  draft.check ??= null;
  draft.location ??= null;
  draft.transactions ??= [];
  draft.quest_open ??= [];
  draft.quest_update ??= [];
  draft.quest_close ??= [];

  const agreed = T(turn).confirmed ? T(turn).proposal : null;
  if (agreed) {
    draft.minutes = agreed.minutes;
    draft.fatigue = agreed.fatigue;
  }
  T(turn).draft = draft;
  const world = (turn.arrival || turn.event) && !turn.action;
  gmPhase(turn, world ? "world" : "outcome", draft.narration);
  turn.correction = null;

  if ((draft.fight || campaign.fight) && !(T(turn).fight?.blows || []).length) {
    const opened = fight.openFight(campaign, draft);
    T(turn).fight = opened;
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
export function showFight(turn: TurnT, running: fight.Fight) {
  for (const entry of T(turn).phases || []) {
    if (entry.kind === "fight") {
      entry.fight = running;
      return entry;
    }
  }
  return gmPhase(turn, "fight", running.said || "", { fight: running });
}

// ── the lore masters ────────────────────────────────────────────────────────

export function derived(raw: any[]): [any[], any[]] {
  const claims: any[] = [];
  const verdicts: any[] = [];
  for (const entry of raw || []) {
    if (!entry || typeof entry !== "object") continue;
    const id = String(entry.id || `c${claims.length + 1}`);
    claims.push({ id, text: String(entry.text || ""), entity: entry.entity ?? null, kind: entry.kind ?? null });
    verdicts.push({
      claim: id,
      result: entry.result || "TRUE",
      why: entry.why || "",
      question: entry.question || "",
      alternative: entry.alternative || "",
      sources: entry.sources || [],
    });
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
      where: campaign.location_path as any[],
      now: worldclock.longStamp(campaign.time as any),
      roster: roster ?? null,
      // The structured half of the draft goes the same way the prose does.
      did: prompts.doings(T(turn).draft) || null,
    }),
    { system: prompts.LORE1_SYSTEM(), tools: [], session: null, model: MODELS.lore1 }
  );
  const facts = (extractJson<any>(read).facts || [])
    .map((f: unknown) => String(f).trim())
    .filter(Boolean);
  T(turn).facts = facts;
  return facts;
}

/**
 * Lore 2: the ruling. The only layer that reads canon, which is what splitting the
 * reading from the ruling was for.
 */
export async function ruleRecord(
  { campaign, turn }: World, narration: string, facts: string[], unknown?: any[] | null
): Promise<[any[], any[], Record<string, any>]> {
  const [text] = await ask(prompts.lore2Turn(narration, facts, unknown), {
    system: prompts.LORE2_SYSTEM(),
    tools: READ_TOOLS,
    permission: sqliteGate({ also: ["tesbota around", "tesbota route"] }),
    session: null,
    model: MODELS.lore2,
  });
  const ruled = extractJson<Record<string, any>>(text);
  const [claims, verdicts] = derived(ruled.claims || []);
  T(turn).draft.claims = claims;

  const settled = new Set((campaign.settled || []).map((t) => canon.plain(t)));
  for (const verdict of verdicts) {
    const claim = claims.find((c) => c.id === verdict.claim);
    if (claim && settled.has(canon.plain(claim.text))) {
      verdict.result = "WITHIN_BOUNDS";
      verdict.why = "already ruled on";
    }
  }
  T(turn).verdicts = verdicts;
  return [claims, verdicts, ruled];
}

/** Nothing can go on until somebody writes the missing document. */
export function holdForLore({ campaign, turn }: World, claims: any[], unresolved: any[]): string {
  const byId = Object.fromEntries(claims.map((c) => [c.id, c]));
  turn.gap = unresolved
    .map((v) => "- " + (String(v.question || "").trim() || byId[v.claim]?.text || v.claim))
    .join("\n");
  const blocked = openPhase(turn);
  if (blocked) blocked.status = "blocked";
  C(campaign).quiet = 0;
  return "unwritten";
}

/**
 * The whole of the lore master's part in a fight. Everything it puts on the ground
 * is ruled on once, here, before a die is thrown — after this the fight belongs to
 * the game master and nobody checks a blow.
 */
export const stepMuster: Step = async (world) => {
  const { campaign, turn } = world;
  const running = T(turn).fight as fight.Fight;
  const strangers = fight.unbound(running).map((x) => ({ id: x.id, name: x.name }));
  const said = running.said || "";
  const facts = await readRecord(world, said, prompts.muster(running));
  const [claims, verdicts, ruled] = await ruleRecord(
    world, said, facts, strangers.length ? strangers : null
  );

  const asked: string[] = [];
  for (const bound of ruled.bodies || []) {
    const declared = canon.slug(bound.declared || "");
    const became = canon.slug(bound.is || "");
    if (became && canon.called(became) && fight.rebind(running, declared, became)) continue;
    const was = strangers.find((x) => x.id === declared)?.name || declared;
    asked.push(String(bound.question || "").trim() || `does ${was} exist, and what is it`);
  }
  for (const stray of fight.unbound(running)) {
    if (!strangers.some((x) => x.id === stray.id)) continue;
    if (!asked.some((q) => q.includes(stray.name) || q.includes(stray.id))) {
      asked.push(`does ${stray.name} exist, and what is it`);
    }
  }
  showFight(turn, running);
  if (asked.length) {
    turn.gap = asked.map((q) => "- " + q).join("\n");
    const blocked = openPhase(turn);
    if (blocked) blocked.status = "blocked";
    C(campaign).quiet = 0;
    return "unwritten";
  }

  const unresolved = verdicts.filter((v) => v.result === "UNRESOLVED");
  if (unresolved.length) return holdForLore(world, claims, unresolved);

  const wrong = verdicts.filter((v) => v.result === "FALSE");
  if (wrong.length) {
    if (turn.gm_retries >= MAX_GM_RETRIES) {
      turn.gap =
        "The game master could not declare a fight that survives adjudication.\n\n" +
        JSON.stringify({ false: wrong }, null, 2);
      return "unwritten";
    }
    turn.gm_retries += 1;
    turn.correction = JSON.stringify({ contradicts_the_record: wrong }, null, 2);
    delete T(turn).fight;
    T(turn).phases = (T(turn).phases || []).filter((x: any) => x.kind !== "fight");
    return "rejected";
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

export function rollCheck({ campaign, turn }: World, rng: Rng = random) {
  const asked = (T(turn).draft || {}).check || {};
  const skill = String(asked.skill || "").trim().toLowerCase();
  const bonus = sheet.skillBonus(campaign, skill);
  if (bonus === null) return null;
  const dc = Math.trunc(Number(asked.dc) || 10);
  const vitals = (campaign.vitals || {}) as any;
  const against = ([["spent", vitals.fatigue], ["starving", vitals.hunger]] as const)
    .filter(([, level]) => Math.trunc(Number(level) || 0) >= 100)
    .map(([word]) => word);
  const rolls = Array.from({ length: 1 + against.length }, () => rng.int(1, SKILL_DIE));
  const roll = Math.min(...rolls);
  const outcome = {
    skill, dc, roll, rolls, against, bonus,
    total: roll + bonus,
    passed: roll + bonus >= dc,
  };
  turn.check = outcome as any;
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
export function tooTired(campaign: CampaignT, draft: Record<string, any>): boolean {
  if (draft.fight) return false;
  const vitals = (campaign.vitals || { fatigue: 0 }) as any;
  return (vitals.fatigue || 0) + Math.trunc(Number(draft.fatigue) || 0) > MAX_FATIGUE;
}

/**
 * Where a rejected draft goes back to. A fight that has already been rolled is
 * settled — the dice are not the lore master's to overturn, only the words are —
 * so it goes back for different words on the same blows, never a fresh fight.
 */
export function redraftEdge(turn: TurnT): string {
  if ((T(turn).fight?.blows || []).length) return "rewrite";
  if (!turn.looking) return "redraft";
  return "reanswer";
}

/** Lore 1 alone: read the world out of it, then hand the facts to the ruling. */
export const stepLore1: Step = async (world) => {
  const { turn } = world;
  const draft = T(turn).draft;

  if (turn.opening) {
    T(turn).verdicts = (draft.claims || []).map((c: any) => ({
      claim: c.id, result: "TRUE", why: "the world opens here",
      question: "", alternative: "", sources: [],
    }));
    return "opens";
  }

  await readRecord(world, draft.narration || "");
  return "read";
};

/** Lore 2 alone: rule on what lore 1 read, and decide where the draft goes. */
export const stepLore2: Step = async (world) => {
  const { campaign, turn } = world;
  const draft = T(turn).draft;
  const narration = draft.narration || "";
  const [claims, verdicts] = await ruleRecord(world, narration, T(turn).facts || []);

  const wrong = verdicts.filter((v) => v.result === "FALSE");
  const unresolved = verdicts.filter((v) => v.result === "UNRESOLVED");

  if (unresolved.length) return holdForLore(world, claims, unresolved);

  if (tooTired(campaign, draft) && !turn.fate && turn.gm_retries < MAX_GM_RETRIES) {
    const vitals = (campaign.vitals || {}) as any;
    turn.gm_retries += 1;
    turn.correction = JSON.stringify({
      too_tired: {
        fatigue_now: vitals.fatigue || 0,
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
    const payload: Record<string, any> = {};

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
    if (turn.gm_retries >= MAX_GM_RETRIES) {
      turn.gap =
        "The game master could not produce a draft that survives adjudication.\n\n" +
        JSON.stringify({ false: wrong }, null, 2);
      return "unwritten";
    }
    turn.gm_retries += 1;
    turn.correction = JSON.stringify({ contradicts_the_record: wrong }, null, 2);
    return redraftEdge(turn);
  }

  return "stands";
};

// ── the fight ───────────────────────────────────────────────────────────────

/**
 * One word back from the explorer, read the way an action is read. Anything that
 * does not parse is a swing, because a body in a fight does not stand still.
 */
export function chosenBlow(said: string, campaign: CampaignT, running?: fight.Fight | null) {
  const first = String(said ?? "").trim().split("\n");
  const head = (first[0] || "").trim().replace(/^["'`*]+|["'`*]+$/g, "").trim();
  const upper = head.toUpperCase();
  if (upper.startsWith("FLEE")) return { verb: "FLEE", what: null };
  if (upper.startsWith("ITEM")) {
    const want = canon.slug(head.slice(4));
    const item = fight.usable(campaign).find((h) => canon.slug(h.name) === want);
    return item ? { verb: "ITEM", what: item } : { verb: "ATTACK", what: null };
  }
  if (upper.startsWith("SKILL")) {
    const name = head.slice(5).split(/\s+/).filter(Boolean).join(" ").toLowerCase().replace(/^[:\- ]+|[:\- ]+$/g, "");
    if (sheet.skillBonus(campaign, name) !== null) {
      return { verb: "SKILL", what: name, mark: aimed(head, running) };
    }
  }
  return { verb: "ATTACK", what: null, mark: aimed(head, running) };
}

/**
 * `ATTACK the rat mother` picks its mark, and picks it by id. Naming nobody leaves
 * the choosing to the driver, which goes for whoever is closest to dropping.
 */
export function aimed(head: string, running?: fight.Fight | null): string | null {
  if (!running) return null;
  const rest = head.split(/\s+/).slice(1).join(" ");
  const want = canon.slug(rest);
  if (!want) return null;
  const found = running.them.find(
    (x: fight.Fighter) => !x.dead && (x.id === want || canon.slug(x.name) === want)
  );
  return found ? found.id : null;
}

/** The one line the explorer is handed before being asked again. */
export function saidBlow(blow: fight.Blow): string {
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
export const stepSwing: Step = async ({ campaign, turn }) => {
  const running = T(turn).fight as fight.Fight;
  const me = running.us[0];
  const first = !running.blows.length;
  const message = first
    ? prompts.fightOpen(running, me, fight.usable(campaign))
    : prompts.fightBlow(running, me, saidBlow(running.blows[running.blows.length - 1]));
  const [text, session] = await ask(message, {
    system: prompts.EXPLORER_SYSTEM(),
    tools: ["Bash"],
    session: (campaign.sessions as any).explorer,
    model: MODELS.explorer,
    permission: explorerPermission as any,
  });
  (campaign.sessions as any).explorer = session;
  T(turn).swing = chosenBlow(firstUtterance(text) || text, campaign, running);
  return "chose";
};

/** The explorer's turn, spent the way they said to spend it. */
export function takeTurn(
  world: World, running: fight.Fight, me: fight.Fighter, blow: fight.Blow, rng: Rng
) {
  const picked = T(world.turn).swing || { verb: "ATTACK", what: null };
  const { verb, what } = picked;
  blow.chose = verb;

  if (verb === "ITEM") {
    blow.chose = `ITEM ${what.name}`;
    blow.mended = canon.does(what.effects);
    (T(world.turn).spent ||= []).push(what.name);
    me.health = Math.min(me.most, me.health + fight.mended(blow, "health"));
    blow.left = me.health;
    return;
  }

  if (verb === "FLEE") {
    const [check] = strike(world, running, me, null, me.skill, running.flee_dc, rng);
    Object.assign(blow, { check, hit: check.passed });
    if (check.passed) running.ended = "fled";
    return;
  }

  const skill = verb === "SKILL" ? what : me.skill;
  if (verb === "SKILL") blow.chose = `SKILL ${what}`;
  const mark = fight.stillUp(running, picked.mark) || fight.marks(running, me);
  if (!mark) return;
  const [check, hurt] = strike(world, running, me, mark, skill, mark.dc, rng);
  Object.assign(blow, { check, hit: check.passed, at: mark.id, atname: mark.name });
  fight.wound(running, mark, hurt, blow);
}

/**
 * One swing. The driver rolls; nobody argues with it. `edge` throws two dice and
 * keeps the better, which is the one thing a body can have going for it.
 */
export function strike(
  world: World | null, running: fight.Fight, who: fight.Fighter, mark: fight.Fighter | null,
  skill: string | null, dc: number, rng: Rng, edge = false, hurts?: string | null
): [any, number] {
  let check: any;
  if (who.kind === "explorer" && world) {
    T(world.turn).draft.check = { skill, dc };
    check = rollCheck(world, rng);
    if (check === null) {
      const roll = rng.int(1, SKILL_DIE);
      check = {
        skill, dc, roll, rolls: [roll], against: [], bonus: who.bonus,
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
export const stepFight: Step = (world, rng = random) => {
  const { turn } = world;
  const running = T(turn).fight as fight.Fight;
  const who = fight.whoseTurn(running);
  if (who === null) {
    running.ended = running.ended || "beaten";
    return "over";
  }

  if (who.kind === "explorer" && !("swing" in T(turn))) return "theirs";

  const blow: fight.Blow = {
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
  };

  if (who.asleep > 0) {
    who.asleep -= 1;
    Object.assign(blow, { chose: "ASLEEP", spent: true });
  } else if (who.kind === "explorer") {
    takeTurn(world, running, who, blow, rng);
  } else if (fight.ready(who) && who.ability?.spawn) {
    const power = who.ability;
    const wait = Math.trunc(Number(power.delay) || 0);
    blow.chose = String(power.name || "spawns");
    if (wait) {
      (running.owed ||= []).push({
        at: running.round + wait, spawn: power.spawn, by: who.name,
      });
      blow.calling = `${power.spawn.name} x${power.spawn.count || 1}`;
    } else {
      blow.spawned = fight.spawn(running, who, rng).map((x) => x.name).join(", ");
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
        null, running, who, mark, who.skill, mark.dc, rng,
        !!power?.advantage, power?.damage
      );
      Object.assign(blow, { check, hit: check.passed, at: mark.id, atname: mark.name });
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
  delete T(turn).swing;
  running.turn += 1;
  if (running.turn >= fight.order(running).length) {
    running.turn = 0;
    running.round += 1;
    fight.arrive(running, rng);
  }

  blow.us = fight.snapshot(running.us);
  blow.them = fight.snapshot(running.them);

  fight.settle(running);
  if (!running.ended && running.blows.length >= MAX_BLOWS) running.ended = "broken";
  return running.ended ? "over" : "next";
};

/** One game master call to put words on a settled exchange. */
export const stepBlows: Step = async ({ campaign, turn }) => {
  const running = T(turn).fight as fight.Fight;
  if (!turn.rolled) rollFate(turn);
  const [text, session] = await ask(
    prompts.gmBlows(running, T(turn).chosen, turn.correction),
    {
      system: prompts.GM_SYSTEM(),
      tools: READ_TOOLS,
      permission: sqliteGate({ also: ["tesbota kill", "tesbota traits", "tesbota around", "tesbota route"] }),
      session: (campaign.sessions as any).gm,
      model: MODELS.gm,
    }
  );
  (campaign.sessions as any).gm = session;
  const out = extractJson<Record<string, any>>(text);
  const lines = (out.blows || []).map((x: unknown) => String(x).trim()).filter(Boolean);
  running.blows.forEach((blow: fight.Blow, n: number) => {
    if (lines[n] !== undefined) blow.text = lines[n];
  });

  // The book keeps the whole of it; the page above the fight shows one line at a
  // time, and takes them from the blows themselves.
  const draft = T(turn).draft;
  draft.narration = [running.said, ...lines].filter(Boolean).join("\n\n").trim();
  draft.location = out.location || draft.location;
  draft.transactions = [...(draft.transactions || []), ...(out.transactions || [])];
  for (const name of T(turn).spent || []) {
    draft.transactions.push({ from: EXPLORER, to: GODHEAD_ID, name, qty: 1 });
  }
  for (const key of ["quest_open", "quest_update", "quest_close"]) {
    draft[key] = out[key] || draft[key] || [];
  }

  const me = running.us[0];
  const mine = running.blows.filter((b: fight.Blow) => b.side === "us" && b.who === me.id).length;
  draft.minutes = Math.max(2, running.round * BLOW_MINUTES);
  draft.fatigue = mine * BLOW_FATIGUE;
  draft.health = me.most ? me.health - me.most : 0;
  const sated = running.blows.reduce((a: number, b: fight.Blow) => a + fight.mended(b, "hunger"), 0);
  draft.hunger = sated || null;
  draft.check = null;
  turn.check = null;

  const told = showFight(turn, running);
  told.text = draft.narration;
  told.status = "pending";
  turn.correction = null;
  // The record was checked when the fight was declared. Swinging is the game
  // master's alone — every blow is a particular, and particulars are never the
  // lore master's to rule on.
  return "written";
};

// ── delivery ────────────────────────────────────────────────────────────────

export function applyVitals(campaign: CampaignT, draft: Record<string, any>): CampaignT {
  const vitals = (C(campaign).vitals ||= { health: MAX_HEALTH, fatigue: 0, hunger: 0 });
  vitals.fatigue = Math.max(0, Math.min(MAX_FATIGUE, (vitals.fatigue || 0) + Math.trunc(Number(draft.fatigue) || 0)));
  vitals.health = Math.max(0, Math.min(MAX_HEALTH, (vitals.health ?? MAX_HEALTH) + Math.trunc(Number(draft.health) || 0)));

  const stated = draft.hunger;
  const drift = ((Math.trunc(Number(draft.minutes) || 0)) / 60) * HUNGER_PER_HOUR;
  const change = stated == null ? drift : Math.trunc(Number(stated));
  vitals.hunger = Math.max(0, Math.min(MAX_HUNGER, Math.round((vitals.hunger || 0) + change)));
  return campaign;
}

/**
 * One ledger. `the-godhead` on either side is the world itself — where bread eaten
 * goes, and where a coin found in the mud comes from.
 */
export function applyInventory(draft: Record<string, any>, turnId?: string | null) {
  for (const entry of draft.transactions || []) {
    if (!entry || typeof entry !== "object" || !entry.name) continue;
    const src = canon.slug(entry.from || "");
    const dst = canon.slug(entry.to || "");
    canon.transfer(
      src === "" || src === GODHEAD_ID ? null : src,
      dst === "" || dst === GODHEAD_ID ? null : dst,
      entry.name,
      Number(entry.qty) || 1,
      turnId
    );
  }
}

const CLOSED = ["done", "failed", "abandoned"];

/**
 * A new errand gets a shape before the game master ever plays it. Nothing here is
 * canon: it is ideation, and the walls it runs into are the point.
 */
export async function scriptFor(quest: any, campaign: CampaignT): Promise<string> {
  try {
    const [text] = await ask(prompts.questmasterTurn(quest, campaign.location_path as any[]), {
      system: prompts.QUESTMASTER_SYSTEM(),
      tools: READ_TOOLS,
      permission: sqliteGate({ also: ["tesbota around", "tesbota route"] }),
      session: null,
      model: MODELS.questmaster,
    });
    return String(extractJson<any>(text).script || "").trim();
  } catch (exc) {
    return `the questmaster fell over: ${(exc as Error).name}: ${exc}`.slice(0, 400);
  }
}

export async function applyQuests(campaign: CampaignT, draft: Record<string, any>, turnId: string) {
  const quests = (C(campaign).quests ||= []) as any[];
  const byId: Record<string, any> = Object.fromEntries(quests.map((q) => [q.id, q]));

  for (const entry of draft.quest_open || []) {
    if (!entry || typeof entry !== "object" || !entry.id) continue;
    const ident = canon.slug(String(entry.id));
    if (byId[ident]) continue;
    const quest: any = {
      id: ident,
      at: worldclock.stamp(campaign.time as any),
      title: String(entry.title || ident.replace(/-/g, " ")),
      detail: String(entry.detail || ""),
      giver: String(entry.giver || ""),
      status: "active",
      opened: turnId,
      closed: null,
      where: [...(campaign.location_path || [])],
    };
    quest.script = await scriptFor(quest, campaign);
    quests.push(quest);
    byId[ident] = quest;
  }

  for (const entry of draft.quest_update || []) {
    if (!entry || typeof entry !== "object") continue;
    const quest = byId[canon.slug(String(entry.id || ""))];
    if (!quest || quest.status !== "active") continue;
    if (entry.detail) quest.detail = String(entry.detail);
  }

  for (const entry of draft.quest_close || []) {
    const ident = entry && typeof entry === "object"
      ? canon.slug(String(entry.id || ""))
      : canon.slug(String(entry));
    const outcome = entry && typeof entry === "object"
      ? String(entry.outcome || "done").toLowerCase()
      : "done";
    const quest = byId[ident];
    if (!quest || quest.status !== "active") continue;
    quest.status = CLOSED.includes(outcome) ? outcome : "done";
    quest.closed = turnId;
    quest.closed_at = worldclock.stamp(campaign.time as any);
  }
  return campaign;
}

/**
 * A fight that outran the guard is carried with everybody's wounds on them. Any
 * other ending closes it. Nought health kills, which nothing in this machine did
 * before a fight could take you there.
 */
export function settleFight(campaign: CampaignT, turn: TurnT): CampaignT {
  const running = T(turn).fight as fight.Fight | undefined;
  if (!running) return campaign;
  if (running.ended === "broken") {
    C(campaign).fight = {
      skill: running.skill,
      flee_dc: running.flee_dc,
      us: running.us.slice(1).filter((x: fight.Fighter) => !x.dead).map((x: fight.Fighter) => ({ ...x })),
      them: running.them.filter((x: fight.Fighter) => !x.dead).map((x: fight.Fighter) => ({ ...x })),
    };
  } else {
    C(campaign).fight = null;
  }
  if (running.ended === "killed" && !pendingDeath()) {
    const felled = [...running.blows].reverse()
      .find((b: fight.Blow) => b.side === "them" && b.taken)?.name || running.name;
    recordDeath(`killed by ${felled}`);
  }
  return campaign;
}

/**
 * Everything a turn changes about the world, applied in one place. Nothing above
 * it writes to the campaign, so a turn that never reaches here leaves no mark —
 * which is what makes a rejected draft safe to throw away.
 */
export const stepDeliver: Step = async ({ campaign, turn }) => {
  if (turn.delivered) return "again";

  const draft = T(turn).draft;

  applyVitals(campaign, draft);
  applyInventory(draft, turn.turn_id);
  await applyQuests(campaign, draft, turn.turn_id);
  settleFight(campaign, turn);

  const where = typeof draft.location === "string" ? draft.location.trim() : "";
  if (where) {
    campaign.location = canon.slug(where.replace(/^\[+|\]+$/g, ""));
    canon.ensureEntity("places", campaign.location, null, turn.turn_id);
    campaign.location_path = canon.ancestry(campaign.location);
  }

  const time = worldclock.advance(campaign.time as any, draft.minutes) as any;
  time.stamp = worldclock.stamp(time);
  time.long = worldclock.longStamp(time);
  C(campaign).time = time;
  turn.at = time.long;
  campaign.last_narration = draft.narration;

  const byVerdict: Record<string, any> = Object.fromEntries(
    (turn.verdicts || []).map((v: any) => [v.claim, v])
  );
  let current = openPhase(turn);
  if (current === null && draft.narration) current = phase(turn, "gm", "world", draft.narration);
  if (current) {
    current.status = "checked";
    current.claims = (draft.claims || []).map((claim: any) => ({
      ...claim, verdict: byVerdict[claim.id] ?? null,
    }));
    if (["outcome", "world"].includes(current.kind)) {
      current.minutes = Math.trunc(Number(draft.minutes) || 0);
      current.fatigue = Math.trunc(Number(draft.fatigue) || 0);
      current.roll = turn.roll;
      current.outcomes = T(turn).outcomes || [];
      current.chosen = T(turn).chosen;
      current.fortune = T(turn).fortune;
      current.transactions = draft.transactions || [];
      current.check = turn.check;
    }
  }
  turn.location_path = campaign.location_path || [];
  turn.vitals = { ...(campaign.vitals as any) };
  const active = (campaign.quests as any[]).find((q) => q?.status === "active");
  turn.quest = active ? active.title : null;

  const clear = () => {
    T(turn).draft = null;
    T(turn).verdicts = [];
    turn.gm_retries = 0;
  };

  if (turn.looking) {
    const bucket = { say: "talks", look: "looks" }[turn.mode as string] || "context";
    (T(turn)[bucket] ||= []).push({ question: turn.question, answer: draft.narration });
    turn.looking = false;
    turn.mode = null;
    turn.question = null;
    clear();
    return "spent";
  }

  if ((turn.arrival || turn.event) && !turn.action) {
    turn.minutes = Math.trunc(Number(draft.minutes) || 0);
    clear();
    return "spent";
  }

  turn.minutes = Math.trunc(Number(draft.minutes) || 0);
  C(campaign).quiet = (campaign.quiet || 0) + 1;
  C(campaign).calm = T(turn).pressed ? 0 : (campaign.calm || 0) + 1;
  turn.resolved = true;
  clear();
  return "spent";
};

/** The handler for each state. The edges they may return are in `machine.ts`. */
export const STEPS: Record<string, Step> = {
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
