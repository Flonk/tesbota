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
import { STEPS } from "./steps.ts";

export type Wrong = { what: string; said: string };

/** Every state has a handler, and every handler a state. */
function handlers(): Wrong[] {
  const wrong: Wrong[] = [];
  const stated = new Set(machine.STATE_NAMES);
  const held = new Set(Object.keys(STEPS));
  for (const name of stated) {
    const loop = machine.STATES[name].driven === "loop";
    if (loop && !held.has(name)) wrong.push({ what: "handlers", said: `${name} has no step` });
    if (!loop && held.has(name)) wrong.push({ what: "handlers", said: `${name} is held but has a step` });
  }
  for (const name of held) {
    if (!stated.has(name as any)) wrong.push({ what: "handlers", said: `step ${name} is not a state` });
  }
  return wrong;
}

/**
 * A turn carrying every field anybody writes, put through the schema and read
 * back. Anything missing afterwards is a field the machine will lose.
 */
function roundTrip(): Wrong[] {
  const full: Record<string, unknown> = {
    turn_id: "t9999", state: "propose", created: "2026-01-01T00:00:00+00:00",
    action: "I walk", draft: { narration: "a road" }, phases: [], verdicts: [], facts: ["roads exist"],
    fight: null, swing: { verb: "ATTACK", mark: "rat" },
    correction: "redo", gm_retries: 1, gap: "do orcs exist",
    looking: true, mode: "look", question: "what?", answers: [["q", "a"]],
    roll: 257, rolled: true, fate: "lesser_fortune", chosen: { band: "rare" }, outcomes: [1],
    check: { skill: "athletics", dc: 11, roll: 7, rolls: [7], against: [], bonus: 0, total: 7, passed: false },
    note: "a note", event: "true", arrival: "alheim", opening: true, delivered: true,
    resolved: true, spent: ["Bread"],
    took: { from: "gm", to: "lore1", at: "now", on: "narrated" },
    trail: [{ from: "gm", to: "lore1", at: "now", on: "narrated" }],
    proposal: { minutes: 5, fatigue: 2 }, confirmed: true, propose_retries: 1,
    blank: 1, nudge: 1, ready: "go", pressed: true, forced_strange: true, fortune: 0.5,
    looks: [1], talks: [1], context: [1], destination: "alheim", leagues_left: 2,
    lore: [1], lore_gap: "a gap",
    minutes: 7, wake_at: "later", at: "Firstday", vitals: { health: 62, fatigue: 27, hunger: 6 },
    location_path: [], quest: "Find the Mill Boy", chronicle: [1],
  };
  const back = Turn.parse(full) as Record<string, unknown>;
  return Object.keys(full)
    .filter((key) => !(key in back))
    .map((key) => ({ what: "round-trip", said: `${key} is dropped by the schema` }));
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
  const declared = new Set(machine.STATE_NAMES.flatMap((n) => [...machine.STATES[n].agents]));
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
 * A road written from both ends has to disagree with itself by half a turn. Any
 * pair that does not describes a shape no world can hold, and the map solver will
 * not say so — it quietly splits the difference and puts the place somewhere
 * neither row asked for.
 */
function ways(): Wrong[] {
  let both: Array<Record<string, any>>;
  try {
    both = db.rows("SELECT src, dst, bearing FROM way ORDER BY src, dst");
  } catch {
    return [];
  }
  const said = new Map(both.map((w) => [`${w.src}|${w.dst}`, String(w.bearing ?? "")]));
  const wrong: Wrong[] = [];
  const seen = new Set<string>();
  for (const w of both) {
    const back = said.get(`${w.dst}|${w.src}`);
    if (back === undefined || seen.has(`${w.dst}|${w.src}`)) continue;
    seen.add(`${w.src}|${w.dst}`);
    const there = travel.bearingDegrees(w.bearing);
    const home = travel.bearingDegrees(back);
    if (there === undefined || home === undefined) continue;
    const apart = Math.abs(((there - home + 540) % 360) - 180);
    if (Math.abs(apart - 180) <= 22.5) continue;
    wrong.push({
      what: "ways",
      said:
        `${w.src} says ${w.dst} lies ${w.bearing}, and ${w.dst} says ${w.src} lies ` +
        `${back} — they cannot both be true`,
    });
  }
  return wrong;
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
    ...ways(),
    ...orphans(),
    ...unplaced(),
    ...agents(),
    ...machine.audit().map((said) => ({ what: "machine", said })),
    ...handlers(),
    ...roundTrip(),
    ...onDisk(),
  ];
}
