/**
 * The loop. It reads the state off the turn, calls the one handler for it, and
 * takes whatever edge the handler named — looked up in `machine.ts`, which is the
 * only thing that knows where an edge leads.
 *
 * A step that names an edge its state does not have is a crash here rather than a
 * world that has quietly gone somewhere nobody wrote down.
 */

import fs from "node:fs";
import path from "node:path";
import * as canon from "./canon.ts";
import * as chronicle from "./chronicle.ts";
import * as sheet from "./sheet.ts";
import * as travel from "./travel.ts";
import * as ground from "./ground.ts";
import { AgentError, STEPS } from "./steps.ts";
import { edgeFrom, STATES, type StateName } from "./machine.ts";
import { random, type Rng } from "./rng.ts";
import { EXPLORER, OPENING, PENDING, STARTING_INVENTORY } from "./config.ts";
import {
  clearDeath, ensureLayout, loadCampaign, loadTurn, newCampaign, newTurn, now,
  pendingDeath, pickName, retire, saveCampaign, saveTurn, stamp, stock, turnPath,
} from "./state.ts";
import type { CampaignT, TurnT } from "./schema.ts";

const SUSPENDED = ["arbiter", "lore3", "clock"];
const TRAIL = 40;

export const pendingPath = (turnId: string) => path.join(PENDING, `${turnId}.md`);

export function writePending(turn: TurnT): string {
  fs.mkdirSync(PENDING, { recursive: true });
  const file = pendingPath(turn.turn_id);
  if (fs.existsSync(file)) return file;
  fs.writeFileSync(
    file,
    `# ${turn.turn_id} — the world is silent\n\n` +
      "## Gap\n\n" +
      `${String(turn.gap ?? "").trim()}\n\n` +
      "## Resolution\n\n" +
      "<!-- run: tesbota lore -->\n",
    "utf8"
  );
  return file;
}

/**
 * The edge the world just crossed, kept on the turn. Two states name an edge on
 * their own, which is why no two edges in the machine may share a pair.
 */
export function took(turn: TurnT, cameFrom: string, edge: string) {
  const landed = turn.state;
  if (!landed || landed === cameFrom) return turn;
  const crossing = { from: cameFrom as StateName, to: landed as StateName, at: stamp(), on: edge };
  (turn as any).took = crossing;
  const trail = ((turn as any).trail ||= []);
  trail.push(crossing);
  if (trail.length > TRAIL) trail.splice(0, trail.length - TRAIL);
  return turn;
}

export async function openWorld(campaign: CampaignT): Promise<TurnT> {
  const turn = newTurn(campaign, "lore1");
  (turn as any).draft = JSON.parse(JSON.stringify(OPENING));
  turn.opening = true;
  const world = { campaign, turn };
  const edge = await STEPS.lore1(world);
  turn.state = edgeFrom("lore1", edge).to;
  saveTurn(turn);
  saveCampaign(campaign);
  return turn;
}

/**
 * End this life and set another walking in the same world. The book closes with
 * what killed them and stays on the shelf; the world keeps everything it has been
 * told.
 */
export async function bury(campaign: CampaignT, cause?: string | null): Promise<TurnT> {
  chronicle.close(cause);
  canon.strip(EXPLORER);
  retire(campaign);
  clearDeath();

  const life = newCampaign() as any;
  life.explorer = pickName();
  life.time = campaign.time || life.time;
  life.clock = campaign.clock || life.clock;
  saveCampaign(life);
  stock(STARTING_INVENTORY as any);

  const turn = await openWorld(life);
  chronicle.ensureBook(turn.turn_id);
  return turn;
}

/**
 * Set them walking. The road either runs out at the destination or stops early,
 * and what is left of it comes back as another leg once the interruption is done.
 */
export function walk(
  campaign: CampaignT, leagues: number, destination: string | null, rng: Rng = random
): TurnT {
  const [minutes, left, cut] = travel.leg(
    campaign.clock as any, leagues, rng, travel.drag(sheet.load(campaign))
  );
  let path: Array<[number, number]> | null = null;
  if (destination) {
    try {
      const found = ground.route(campaign.location ?? null, destination);
      if (!("error" in found)) path = found.path;
    } catch {}
  }
  return newTurn(campaign, "clock", {
    wake_at: stamp(new Date(now().getTime() + travel.realDelayMs(campaign.clock as any, minutes))),
    destination,
    leagues_left: cut ? left : 0,
    path,
    reach: cut && leagues ? Number(((leagues - left) / leagues).toFixed(4)) : 1,
  });
}

export function advance(campaign: CampaignT, turn: TurnT): TurnT {
  const journey = ((turn as any).draft || {}).travel || {};
  if (journey.leagues) return walk(campaign, journey.leagues, journey.destination ?? null);

  const minutes = Math.trunc(Number(turn.minutes) || 0);
  if (minutes > 0) {
    return newTurn(campaign, "clock", {
      wake_at: stamp(new Date(now().getTime() + travel.realDelayMs(campaign.clock as any, minutes))),
    });
  }
  return newTurn(campaign, "explorer");
}

/** Whether the walking is done, and what the world does about it if so. */
export function tickClock(turn: TurnT, moment: Date): boolean {
  if (!travel.arrived(turn as any, moment)) return false;
  const destination = (turn as any).destination;
  turn.wake_at = null;
  if ((turn as any).leagues_left) {
    turn.event = "true";
    turn.state = edgeFrom("clock", "arrived").to;
    return true;
  }
  if (destination) {
    turn.arrival = destination;
    turn.state = edgeFrom("clock", "arrived").to;
  } else {
    turn.state = edgeFrom("clock", "woken").to;
  }
  return true;
}

export type Ran = { state: string; turn: TurnT };

export async function run(limit = 1): Promise<Ran> {
  ensureLayout();
  const campaign = loadCampaign();

  // A world with no turn yet gets one before anything reads it.
  const opened = campaign.current_turn ?? newTurn(campaign, "explorer").turn_id;
  if (campaign.paused) return { state: "paused", turn: loadTurn(opened) };

  let completed = 0;
  for (;;) {
    const turn = loadTurn(campaign.current_turn ?? opened);
    const state = turn.state as StateName;

    const death = pendingDeath();
    if (death && (state === "done" || SUSPENDED.includes(state))) {
      return { state: "done", turn: await bury(campaign, death.cause) };
    }

    if (state === "arbiter") {
      writePending(turn);
      return { state: "arbiter", turn };
    }

    // The lore master has it. `say` moved the turn here before it asked, and
    // `say` is what moves it off again; the loop must not walk into the middle
    // of an answer that is still being written.
    if (state === "lore3") return { state: "lore3", turn };

    if (state === "clock") {
      if (!tickClock(turn, now())) return { state: "clock", turn };
      saveTurn(turn);
      continue;
    }

    if (state === "done") {
      if (completed >= limit) return { state: "done", turn };
      advance(campaign, turn);
      continue;
    }

    const step = STEPS[state];
    if (!step) throw new Error(`no handler for state \`${state}\``);

    const world = { campaign, turn };
    const edge = await step(world);
    // The machine decides where an edge goes. A step that names one its state does
    // not have stops here rather than putting the world somewhere unwritten.
    turn.state = edgeFrom(state, edge).to;
    took(turn, state, edge);
    saveTurn(turn);
    saveCampaign(campaign);
    if (turn.state === "done") completed += 1;
  }
}

/**
 * What was holding a turn up has been settled. The draft goes back to whoever can
 * use the ruling, which for a rolled fight is its words and never its dice.
 */
export function resolveGap(campaign: CampaignT, turn: TurnT): TurnT {
  const claims = ((turn as any).draft || {}).claims || [];
  const unresolved = new Set(
    (turn.verdicts || []).filter((v: any) => v.result === "UNRESOLVED").map((v: any) => v.claim)
  );
  const settled = ((campaign as any).settled ||= []) as string[];
  for (const claim of claims) {
    if (unresolved.has(claim.id) && !settled.includes(claim.text)) settled.push(claim.text);
  }
  if (settled.length > 60) settled.splice(0, settled.length - 60);

  turn.gap = null;
  turn.gm_retries = 0;
  for (const entry of [...((turn as any).phases || [])].reverse()) {
    if (entry.status === "blocked") {
      entry.status = "pending";
      break;
    }
  }
  turn.correction = JSON.stringify({
    ruled:
      "What was holding this up has been settled and canon has been written. " +
      "Read canon again before you answer.",
    your_rejected_draft: ((turn as any).draft || {}).narration,
    instruction:
      "Give this again. Keep everything the record now supports — the ruling " +
      "was made so that you could say it, not so that you would drop it. " +
      "Change only what canon actually contradicts.",
  }, null, 2);

  const blows = ((turn as any).fight || {}).blows || [];
  const edge = blows.length ? "ruled_fight" : turn.looking ? "ruled_answer" : "ruled";
  turn.state = edgeFrom("lore3", edge).to;
  saveTurn(turn);
  const file = pendingPath(turn.turn_id);
  if (fs.existsSync(file)) fs.rmSync(file);
  return turn;
}

export { AgentError, STATES };
