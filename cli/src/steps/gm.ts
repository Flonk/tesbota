import { z } from "zod";
import * as canon from "../canon.ts";
import * as fight from "../fight.ts";
import * as prompts from "../prompts.ts";
import * as sheet from "../sheet.ts";
import * as worldclock from "../worldclock.ts";
import { ask, extractJson } from "../agent.ts";
import { random } from "../rng.ts";
import { Draft, Listed, Written, type CampaignT, type DraftT, type OutcomeT, type TurnT } from "../schema.ts";
import {
  BANDS, BLOW_FATIGUE, BLOW_MINUTES, EXPLORER, GODHEAD_ID, MAX_ASKS, MAX_PROPOSE_RETRIES,
  PRESS_FLOOR, SPARK_FLOOR, TRIVIAL_FATIGUE, TRIVIAL_MINUTES, WEIGHT,
} from "../config.ts";
import { rollFate } from "./dice.ts";
import { standingIn } from "./deliver.ts";
import { drafted, fightOf, gmPhase, onRoad, openPhase, type Step } from "./turn.ts";

/**
 * What the game master's session has already been handed. A session that has gone
 * means it has been handed nothing, so the slate goes with it.
 */
function ledger(campaign: CampaignT): Record<string, string> {
  if (!campaign.sessions.gm) campaign.sent = {};
  return campaign.sent;
}

async function askGm(campaign: CampaignT, message: string, agent: "gm" | "answer" = "gm"): Promise<string> {
  const [text, session] = await ask(agent, message, campaign.sessions.gm);
  campaign.sessions.gm = session;
  return text;
}

const Answered = Draft.pick({ narration: true });

export const stepAnswer: Step<"answer"> = async ({ campaign, turn }) => {
  const { mode, question } = turn.asking ?? { mode: "look", question: "" };
  const text = await askGm(
    campaign,
    prompts.gmAnswer(question, {
      previous: campaign.last_narration ?? null,
      mode,
      inventory: canon.holdings(EXPLORER),
      load: sheet.load(campaign),
      others: canon.holdingsAt(campaign.location),
      correction: turn.correction ?? null,
      sent: ledger(campaign),
    }),
    "answer"
  );
  const draft = Draft.parse(extractJson(text, Answered));
  turn.draft = draft;
  gmPhase(turn, "answer", draft.narration);
  turn.correction = null;
  return "answered";
};

/**
 * Six ways it could go, one to a band up the ladder, weights made to add up. A
 * malformed table is thrown away; a missing weight falls back to its band.
 */
function weighOutcomes(raw: unknown): OutcomeT[] {
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

function spin(outcomes: OutcomeT[], fortune: number, only?: string | string[] | null): OutcomeT {
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
    "propose",
    prompts.gmPropose(turn.action, {
      previous: campaign.last_narration ?? null,
      vitals: campaign.vitals,
      answers: turn.answers,
      note: turn.note ?? null,
      inventory: canon.holdings(EXPLORER),
      load: sheet.load(campaign),
      others: canon.holdingsAt(campaign.location),
      now: worldclock.longStamp(campaign.time),
    })
  );
  const out = extractJson(text, Written);

  const question = typeof out.ask === "string" ? out.ask.trim() : null;
  const answers = turn.answers;
  if (question && answers.length < MAX_ASKS) {
    const [reply] = await ask("queries", question);
    answers.push([question, reply.trim()]);
    return "again";
  }

  const said = Written.safeParse(out.proposal).data;

  if (!said || !("minutes" in said)) {
    turn.propose_retries += 1;
    if (turn.propose_retries < MAX_PROPOSE_RETRIES) return "again";
    turn.proposal = {
      summary: turn.action || "",
      minutes: TRIVIAL_MINUTES,
      fatigue: TRIVIAL_FATIGUE,
    };
  } else {
    turn.proposal = {
      summary: String(said.summary ?? (turn.action || "")),
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
  }
  return "priced";
};

function duePress(turn: TurnT, campaign?: CampaignT | null): boolean {
  return (turn.pressed ??= (campaign?.calm || 0) >= PRESS_FLOOR);
}

export const stepGm: Step<"gm"> = async ({ campaign, turn }) => {
  const agreed = turn.proposal ?? null;
  const world = onRoad(turn);
  const text = await askGm(
    campaign,
    prompts.gmTurn(turn.action, {
      previous: campaign.last_narration ?? null,
      vitals: campaign.vitals,
      correction: turn.correction ?? null,
      journey: world ? turn.journey : null,
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
    })
  );

  const said = extractJson(text, Written);
  const draft = Draft.parse({
    ...said,
    claims: [],
    destination: said.destination !== undefined
      ? said.destination
      : turn.destination ?? turn.journey?.to ?? standingIn(campaign),
    ...(agreed ? { minutes: agreed.minutes, fatigue: agreed.fatigue } : {}),
  });
  turn.draft = draft;
  turn.correction = null;

  if (draft.fight) {
    const opened = fight.openFight(campaign, draft);
    // The page draws whatever is on the turn, so the fight goes on the turn the
    // moment it is declared. Waiting for the last blow means nobody sees any of it.
    gmPhase(turn, "fight", opened.said, { fight: opened });
    return "declares";
  }
  gmPhase(turn, world ? "world" : "outcome", draft.narration);
  return "narrated";
};

const Worded = Draft.pick({
  destination: true, transactions: true, quest_open: true, quest_update: true, quest_close: true,
}).extend({ blows: Listed(z.coerce.string()) });

/** One game master call to put words on a settled exchange. */
export const stepBlows: Step<"blows"> = async ({ campaign, turn }) => {
  const running = fightOf(turn);
  const fate = turn.roll == null ? rollFate(turn) : null;
  const text = await askGm(campaign, prompts.gmBlows(running, fate));
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
    health: me.health - me.opened,
    hunger: sated || null,
  };
  turn.draft = draft;
  turn.check = null;

  const told = openPhase(turn);
  if (told) told.text = draft.narration;
  // The record was checked when the fight was declared. Swinging is the game
  // master's alone — every blow is a particular, and particulars are never the
  // lore master's to rule on.
  return "written";
};
