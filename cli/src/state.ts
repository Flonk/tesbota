/**
 * What is on disk between turns: the campaign, the turns themselves, and the
 * note that a life has ended.
 *
 * Everything is written to a temporary file and moved into place, so a reader
 * arriving mid-write sees the turn before rather than half of the turn after.
 */

import fs from "node:fs";
import path from "node:path";
import * as canon from "./canon.ts";
import { random, type Rng } from "./rng.ts";
import {
  CAMPAIGN, DEATH, DEFAULTS, EXPLORER, FIRST_NAMES, MAX_HEALTH, PENDING,
  STARTING_INVENTORY, STARTING_SKILLS, STATE, SURNAME, TURNS, WORLD_START,
} from "./config.ts";
import type { StateName } from "./machine.ts";
import { Campaign, Turn, type CampaignT, type TurnT } from "./schema.ts";

export const now = () => new Date();

/** Seconds, no milliseconds — the way `datetime.isoformat(timespec="seconds")` writes one. */
export const stamp = (dt: Date = now()) => dt.toISOString().replace(/\.\d{3}Z$/, "+00:00");

export const parse = (value: string) => new Date(value);

export function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

export const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));

/**
 * Every life gets its own name. The family name never changes; the world only
 * ever meets one Bota at a time.
 */
export function pickName(rng: Rng = random): string {
  const taken = canon.givenNames();
  const pool = FIRST_NAMES.filter((n) => !taken.has(n.toLowerCase()));
  return `${rng.pick(pool.length ? pool : FIRST_NAMES)} ${SURNAME}`;
}

export const explorerName = (campaign?: CampaignT | null) =>
  (campaign ?? loadCampaign()).explorer || "the explorer";

export function newCampaign(): Record<string, unknown> {
  return {
    explorer: null,
    sessions: { explorer: null, gm: null, lore3_sitting: null },
    sent: {},
    fight: null,
    current_turn: null,
    turn_counter: 0,
    clock: { ...DEFAULTS },
    time: { ...WORLD_START },
    vitals: { health: MAX_HEALTH, fatigue: 0, hunger: 0 },
    quests: [],
    skills: JSON.parse(JSON.stringify(STARTING_SKILLS)),
    last_narration: null,
    note: null,
    location: null,
    location_path: [],
    last_seen: null,
    created: stamp(),
  };
}

type KitEntry = { name: string; effects?: Record<string, string>; [k: string]: unknown };

/**
 * Every kind of thing in the kit has a row of its own, held or not, so what a
 * thing is does not depend on somebody carrying one.
 */
export function catalogue(inventory: readonly KitEntry[]) {
  for (const entry of inventory) {
    if (!entry || typeof entry !== "object" || !entry.name) continue;
    canon.describe(entry.name, entry.effects ?? null, {
      type: entry.type, weight: entry.weight, worth: entry.worth,
      owed_by: entry.owed_by, rarity: entry.rarity, slot: entry.slot,
    });
  }
}

/**
 * Move what the explorer was carrying in the campaign file into canon, where
 * everything anybody holds now lives.
 */
export function stock(inventory: readonly (KitEntry | string)[]) {
  catalogue(inventory.filter((e): e is KitEntry => typeof e === "object" && e !== null));
  for (const entry of inventory) {
    if (typeof entry === "object" && entry !== null) {
      canon.give(EXPLORER, entry.name, Number(entry.qty ?? 1) || 1, !!entry.worn);
    } else {
      canon.give(EXPLORER, entry);
    }
  }
}

/**
 * The campaign if there is one, and nothing if there is not. Reading the world
 * should never bring an adventurer into being — a map drawn on an empty profile
 * was minting a name and a life to draw it with.
 */
export const campaignIfAny = (): CampaignT | null =>
  fs.existsSync(CAMPAIGN) ? loadCampaign() : null;

export function loadCampaign(): CampaignT {
  if (!fs.existsSync(CAMPAIGN)) {
    const made = newCampaign();
    made.explorer = pickName();
    writeJson(CAMPAIGN, made);
    return Campaign.parse(made);
  }

  const held = readJson(CAMPAIGN) as Record<string, unknown>;
  const blank = newCampaign();
  let changed = false;
  if (!held.explorer) {
    held.explorer = pickName();
    changed = true;
  }
  for (const key of ["note", "location", "location_path", "quests", "time"]) {
    if (!(key in held)) {
      held[key] = blank[key];
      changed = true;
    }
  }
  for (const key of ["skills", "clock"]) {
    if (!held[key]) {
      held[key] = blank[key];
      changed = true;
    }
  }
  if ("inventory" in held) {
    stock((held.inventory as KitEntry[]) || []);
    delete held.inventory;
    changed = true;
  }
  const vitals = (held.vitals ||= blank.vitals) as Record<string, number>;
  for (const [key, value] of Object.entries(blank.vitals as Record<string, number>)) {
    if (!(key in vitals)) {
      vitals[key] = value;
      changed = true;
    }
  }
  if (changed) writeJson(CAMPAIGN, held);
  return Campaign.parse(held);
}

export const saveCampaign = (campaign: CampaignT) => writeJson(CAMPAIGN, campaign);

/**
 * A death is asked for here and carried out by the driver, because whoever calls
 * for one may be in the middle of a turn that still has to be written.
 */
export function recordDeath(cause: string) {
  writeJson(DEATH, { cause, at: stamp() });
  return cause;
}

export const pendingDeath = () =>
  fs.existsSync(DEATH) ? (readJson(DEATH) as { cause?: string; at?: string }) : null;

export const clearDeath = () => fs.rmSync(DEATH, { force: true });

/**
 * Put a finished life away whole — its turns, its campaign file, whatever the
 * world was still waiting on it for. What it wrote stays in the library.
 */
export function retire(campaign: CampaignT): string {
  const home = path.join(STATE, "lives", canon.slug(explorerName(campaign)) || "the-nameless");
  fs.mkdirSync(path.join(home, "turns"), { recursive: true });
  for (const name of turnFiles()) {
    fs.renameSync(path.join(TURNS, name), path.join(home, "turns", name));
  }
  if (fs.existsSync(PENDING)) {
    for (const name of fs.readdirSync(PENDING).filter((f) => f.endsWith(".md")).sort()) {
      fs.renameSync(path.join(PENDING, name), path.join(home, name));
    }
  }
  for (const name of ["campaign.json", "lore3.json"]) {
    const kept = path.join(STATE, name);
    if (fs.existsSync(kept)) fs.renameSync(kept, path.join(home, name));
  }
  return home;
}

export const turnPath = (turnId: string) => path.join(TURNS, `${turnId}.json`);

const turnFiles = () => {
  try {
    return fs.readdirSync(TURNS).filter((f) => /^t\d+\.json$/.test(f)).sort();
  } catch {
    return [];
  }
};

export const allTurns = (): TurnT[] =>
  turnFiles().map((f) => Turn.parse(readJson(path.join(TURNS, f))));

export function newTurn(
  campaign: CampaignT, state: StateName = "explorer", fields: Record<string, unknown> = {}
): TurnT {
  campaign.turn_counter += 1;
  const turnId = `t${String(campaign.turn_counter).padStart(4, "0")}`;
  const turn = Turn.parse({
    turn_id: turnId,
    state,
    created: stamp(),
    action: null,
    draft: null,
    verdicts: [],
    correction: null,
    gm_retries: 0,
    gap: null,
    wake_at: null,
    minutes: 0,
    ...fields,
  });
  campaign.current_turn = turnId;
  writeJson(turnPath(turnId), turn);
  saveCampaign(campaign);
  return turn;
}

export const loadTurn = (turnId: string): TurnT => Turn.parse(readJson(turnPath(turnId)));

export const saveTurn = (turn: TurnT) => writeJson(turnPath(turn.turn_id), turn);

export function ensureLayout() {
  fs.mkdirSync(STATE, { recursive: true });
  fs.mkdirSync(TURNS, { recursive: true });
}

export { STARTING_INVENTORY };
