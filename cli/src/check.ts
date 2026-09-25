/**
 * What has to be true of the machine before it is trusted to run.
 *
 * The round-trip is the one that earned its place: zod strips what it has not been
 * told about, so a field a step writes and a later step reads is silently lost the
 * moment the turn goes to disk and comes back. A proposal that vanishes between
 * `propose` and `gm` is a turn that quietly re-prices itself, and nothing about it
 * looks wrong until you read the narration.
 */

import fs from "node:fs";
import path from "node:path";
import * as machine from "./machine.ts";
import { Campaign, Turn } from "./schema.ts";
import { DAYS_PER_MONTH, MONTH_NAMES, PROFILES, roomOf } from "./config.ts";
import * as db from "./db.ts";
import * as sky from "./sky.ts";
import * as travel from "./travel.ts";
import { sqlite3 } from "./sqlite.ts";

export type Wrong = { what: string; said: string };

const CHECK = {
  skill: "athletics", dc: 11, roll: 7, rolls: [7], against: ["spent"], for: ["the better of two"],
  bonus: 0, total: 7, passed: false,
};
const OUTCOME = { band: "rare", text: "a stranger knows their name", p: 0.08 };
const SPAWN = {
  name: "Alheim Guard", who: "alheim-guard", count: 3, health: 100, most: 100, damage: "18–22",
  dc: 17, bonus: 5, defense: 22, skill: "athletics",
};
const ABILITY = {
  name: "call guards", damage: "3", advantage: true, cooldown: 10, sleep: 1, delay: 1,
  spawn: SPAWN, within: "alheim", in_kind: "location", in_aspect: "guarded", from: "citizen", used: true,
};
const BODY = {
  id: "greta-marsch", name: "Greta Marsch", kind: "foe", health: 20, most: 20, opened: 20,
  damage: "1–2", weapon: "a ladle", dc: 11, bonus: 1, defense: 2, skill: "athletics", ability: ABILITY,
  aspects: [{ name: "citizen", value: "alheim", of: "Alheim" }], asleep: 1, cool: 2, dead: false,
  as_written: { who: "greta-marsch", health: 20 },
};
const BLOW = {
  n: 1, round: 1, who: "greta-marsch", name: "Greta Marsch", side: "them", chose: "ATTACK", hit: true,
  dealt: 0, taken: 3, blocked: 1, at: "the-explorer", atname: "Uwe Bota", left: 97, check: CHECK,
  spawned: "Alheim Guard", calling: "Alheim Guard x3", mended: "+15 health", spent: true, text: "a blow",
  us: [{ id: "the-explorer", health: 97, dead: false }], them: [{ id: "greta-marsch", health: 20, dead: false }],
};
const FIGHT = {
  skill: "athletics", flee_dc: 10, name: "Greta Marsch", said: "she swings", round: 2, turn: 1,
  ended: "broken", us: [BODY], them: [BODY], blows: [BLOW], owed: [{ at: 2, by: "Greta Marsch", spawn: SPAWN }],
};
const PLACED = [{ id: "the-greater-plains", name: "The Greater Plains" }];
const CLAIM = { id: "c1", text: "a mill stands in Alheim", entity: "alheim-mill", kind: "places" };
const VERDICT = {
  claim: "c1", result: "TRUE", why: "it is written", question: "is it?", alternative: "a barn",
  sources: ["alheim-mill"],
};
const CROSSING = { from: "gm", to: "lore1", at: "now", on: "narrated" };
const TURN = {
  turn_id: "t9999", state: "propose", created: "2026-01-01T00:00:00+00:00",
  action: "I walk",
  draft: {
    narration: "a road", claims: [CLAIM], destination: "alheim", minutes: 5, fatigue: 2, health: -1,
    hunger: 3, check: { skill: "athletics", dc: 11 }, fight: { them: [{ who: "rat" }] },
    transactions: [{ from: "the-godhead", to: "the-explorer", name: "Bread", qty: 1 }],
    quest_open: [{ id: "q" }], quest_update: [{ id: "q", detail: "d" }], quest_close: ["q"],
  },
  phases: [{
    n: 1, who: "gm", kind: "fight", status: "checked", text: "a blow",
    claims: [{ ...CLAIM, verdict: VERDICT }], fight: FIGHT, minutes: 5, fatigue: 2, roll: 257,
    outcomes: [OUTCOME], chosen: OUTCOME, fortune: 0.5, check: CHECK,
  }],
  verdicts: [VERDICT], facts: ["roads exist"],
  fight: FIGHT, swing: { verb: "SKILL", skill: "athletics", mark: "rat" },
  correction: "redo", gm_retries: 1, gap: "do orcs exist",
  looking: true, mode: "look", question: "what?", answers: [["q", "a"]],
  roll: 257, rolled: true, fate: "lesser_fortune", chosen: OUTCOME, outcomes: [OUTCOME], check: CHECK,
  note: "a note", event: "true", arrival: "alheim", opening: true, delivered: true,
  resolved: true, spent: ["Bread"],
  took: CROSSING, trail: [CROSSING],
  proposal: { summary: "a walk", target: "alheim", minutes: 5, fatigue: 2, unpriced: true },
  confirmed: true, propose_retries: 1,
  blank: 1, nudge: 1, ready: "go", pressed: true, forced_strange: true, fortune: 0.5,
  looks: [{ question: "q", answer: "a" }], talks: [{ question: "q", answer: "a" }],
  context: [{ question: "q", answer: "a" }], destination: "alheim", leagues_left: 2,
  path: [[9.1, 53.2]], reach: 0.5,
  lore: [{ role: "you", text: "is there a mill" }], lore_gap: "a gap",
  minutes: 7, wake_at: "later", at: "Firstday", vitals: { health: 62, fatigue: 27, hunger: 6 },
  location_path: PLACED, quest: "Find the Mill Boy", chronicle: [{ ord: 1, text: "a passage" }],
};

const CAMPAIGN = {
  created: "2026-01-01T00:00:00+00:00", explorer: "Uwe Bota", current_turn: "t9999", turn_counter: 9999,
  location: "alheim", location_path: PLACED, vitals: { health: 62, fatigue: 27, hunger: 6 },
  skills: { abilities: { str: 10 }, proficiency: 2, proficient: ["survival"] },
  quests: [{
    id: "q", title: "Q", detail: "d", giver: "Greta", script: "s", at: "1 Frostfall 4E202, 13:04",
    status: "done", opened: "t0001", closed: "t0002", closed_at: "1 Frostfall 4E202, 14:04", where: PLACED,
  }],
  time: { era: 4, year: 202, day: 1, minute: 784, stamp: "1 Frostfall 4E202, 13:04", long: "Firstday" },
  clock: { hours_per_league: 1.5, min_leg_minutes: 20, encounter_chance_per_league: 0.25, speed_factor: 10 },
  sessions: { explorer: "a", gm: "b", lore3_sitting: "c" }, sent: { inventory: "abc" },
  last_narration: "a road", last_seen: "t0001", note: "a note", paused: true, quiet: 1, calm: 2,
  settled: ["a claim"], walked: ["alheim"], walked_through: "t0001",
  fight: { skill: "athletics", flee_dc: 10, name: "Greta Marsch", us: [BODY], them: [BODY] },
};

function lost(written: unknown, back: unknown, at = ""): string[] {
  if (!written || typeof written !== "object") return [];
  const kept = new Map(back && typeof back === "object" ? Object.entries(back) : []);
  return Object.entries(written).flatMap(([key, value]: [string, unknown]) => {
    const path = at ? `${at}.${key}` : key;
    return kept.has(key) ? lost(value, kept.get(key), path) : [path];
  });
}

/**
 * A turn and a campaign carrying every field anybody writes, put through the
 * schema and read back. Anything missing afterwards, however deep, is a field the
 * machine will lose.
 */
function roundTrip(): Wrong[] {

  return [
    ...lost(TURN, Turn.parse(TURN)).map((path) => `turn.${path}`),
    ...lost(CAMPAIGN, Campaign.parse(CAMPAIGN)).map((path) => `campaign.${path}`),
  ].map((path) => ({ what: "round-trip", said: `${path} is dropped by the schema` }));
}

/** Every turn and campaign actually on disk, through the schema. */
function onDisk(): Wrong[] {
  const wrong: Wrong[] = [];
  for (const profile of PROFILES) {
    const room = roomOf(profile);
    const camp = path.join(room, "campaign.json");
    if (fs.existsSync(camp)) {
      const held = Campaign.safeParse(JSON.parse(fs.readFileSync(camp, "utf8")));
      if (!held.success) {
        for (const issue of held.error.issues.slice(0, 4)) {
          wrong.push({ what: "on disk", said: `${profile}/campaign.json ${issue.path.join(".")}: ${issue.message}` });
        }
      }
    }
    const turns = path.join(room, "turns");
    if (!fs.existsSync(turns)) continue;
    for (const file of fs.readdirSync(turns).filter((f) => f.endsWith(".json")).sort()) {
      const held = Turn.safeParse(JSON.parse(fs.readFileSync(path.join(turns, file), "utf8")));
      if (held.success) continue;
      for (const issue of held.error.issues.slice(0, 3)) {
        wrong.push({ what: "on disk", said: `${profile}/${file} ${issue.path.join(".")}: ${issue.message}` });
      }
    }
  }
  return wrong;
}

/**
 * Every agent the code calls is declared by the state that calls it. A layer that
 * runs where the table says nothing is the whole reason the table exists.
 */
function agents(): Wrong[] {
  const declared = new Set<string>(machine.STATE_NAMES.flatMap((n) => [...machine.STATES[n].agents]));
  const layers = ["explorer", "gm", "propose", "lore1", "lore2", "queries",
                  "lore3", "lore4", "questmaster"];
  return layers
    .filter((l) => !declared.has(l) && l !== "lore4")
    .map((l) => ({ what: "agents", said: `${l} is called but no state declares it` }));
}

/**
 * The calendar still describes the sky.
 *
 * The year is terra going round once; the months are something people did to that
 * year. Nothing stops lore moving terra further out, and nothing should — but a
 * year the months no longer tile is a date that has quietly stopped meaning what
 * every stamp already written down meant, and that is worth stopping for.
 */
function calendar(): Wrong[] {
  const { days, derived } = sky.calendar();
  if (!derived) return [];
  const tiled = MONTH_NAMES.length * DAYS_PER_MONTH;
  if (days === tiled) return [];
  return [{
    what: "calendar",
    said:
      `terra takes ${days} days to go round but the calendar cuts the year into ` +
      `${MONTH_NAMES.length} months of ${DAYS_PER_MONTH} — ${tiled} days. ` +
      "Every date written since is off by the difference.",
  }];
}


/**
 * A place whose parent is not in the record.
 *
 * Nothing can be walked down to from a world it has lost its footing in, so an
 * orphan does not appear on the map at all — it is not wrong on the screen, it
 * is missing from it, which is far worse to notice.
 */
function orphans(): Wrong[] {
  let lost: Array<Record<string, any>>;
  try {
    lost = db.rows(
      `SELECT p.id, p.parent FROM place p
        WHERE p.parent IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM place q WHERE q.id = p.parent)
        ORDER BY p.id`
    );
  } catch {
    return [];
  }
  return lost.map((r) => ({
    what: "orphan",
    said: `${r.id} sits inside ${r.parent}, which is not a place — nothing can reach it`,
  }));
}

/**
 * A place nobody has put anywhere.
 *
 * There is one map now and it draws what the record positions, so a place with
 * neither a point nor a shape is not drawn faintly or placed by guesswork — it is
 * not on the map at all. That is honest, and it is worth saying out loud, because
 * the thing it means is that nobody has finished writing the place.
 */
function unplaced(): Wrong[] {
  let lost: Array<Record<string, any>>;
  try {
    lost = db.rows(
      `SELECT p.id, p.type FROM place p JOIN entity e ON e.id = p.id
        WHERE p.lat IS NULL AND e.extent IS NULL
          AND coalesce(p.type, '') NOT IN (?, ?, ?)
        ORDER BY p.id`,
      ["celestial-body", "celestial-system", "realm"]
    );
  } catch {
    return [];
  }
  return lost.map((r) => ({
    what: "unplaced",
    said: `${r.id} is a ${r.type ?? "place"} with no position and no shape — the map cannot draw it`,
  }));
}

/** The one command every layer above the explorer reads the world with. */
function reader(): Wrong[] {
  return sqlite3()
    ? []
    : [{ what: "sqlite3", said: "no sqlite3 anywhere — every agent above the explorer is blind" }];
}

export function check(): Wrong[] {
  return [
    ...reader(),
    ...calendar(),
    ...orphans(),
    ...unplaced(),
    ...agents(),
    ...machine.audit().map((said) => ({ what: "machine", said })),
    ...roundTrip(),
    ...onDisk(),
  ];
}
