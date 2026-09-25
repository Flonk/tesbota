/**
 * What has to be true of the machine before it is trusted to run.
 *
 * Reading what is on disk back through the schema is the one that earned its
 * place: zod strips what it has not been told about. Every save now writes what
 * the schema reads, so what is left to catch is a file from before a field was
 * renamed or declared, or one edited by hand: a key the next load quietly drops,
 * or a value it reads back as something else. A debug turn still holding
 * `draft.location` after `destination` replaced it delivers nowhere, and nothing
 * about it looks wrong until the explorer never moves.
 */

import fs from "node:fs";
import path from "node:path";
import * as machine from "./machine.ts";
import { AGENTS } from "./agents.ts";
import { Campaign, Turn } from "./schema.ts";
import { DAYS_PER_MONTH, MONTH_NAMES, PROFILES, roomOf } from "./config.ts";
import * as db from "./db.ts";
import * as sky from "./sky.ts";
import { sqlite3 } from "./sqlite.ts";

export type Wrong = { what: string; said: string; ids?: string[] };

function unread(written: unknown, back: unknown, at = ""): string[] {
  if (!written || typeof written !== "object") {
    return Object.is(written, back) ? [] : [`${at} ${JSON.stringify(written)} reads back as ${JSON.stringify(back)}`];
  }
  const kept = new Map(back && typeof back === "object" ? Object.entries(back) : []);
  return Object.entries(written).flatMap(([key, value]: [string, unknown]) => {
    const path = at ? `${at}.${key}` : key;
    if (!kept.has(key)) return [`${path} is not in the schema and is dropped on load`];
    return unread(value, kept.get(key), path);
  });
}

/** Every turn and campaign actually on disk, through the schema. */
function onDisk(): Wrong[] {
  const wrong: Wrong[] = [];
  const read = (file: string, name: string, shape: typeof Turn | typeof Campaign) => {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const held = shape.safeParse(raw);
    const said = held.success
      ? unread(raw, held.data)
      : held.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    for (const line of said) wrong.push({ what: "on disk", said: `${name} ${line}` });
  };
  for (const profile of PROFILES) {
    const room = roomOf(profile);
    const camp = path.join(room, "campaign.json");
    if (fs.existsSync(camp)) read(camp, `${profile}/campaign.json`, Campaign);
    const turns = path.join(room, "turns");
    if (!fs.existsSync(turns)) continue;
    for (const file of fs.readdirSync(turns).filter((f) => f.endsWith(".json")).sort()) {
      read(path.join(turns, file), `${profile}/${file}`, Turn);
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
  return Object.keys(AGENTS)
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
  } catch (err) {
    return [{ what: "canon", said: `could not read places: ${(err as Error).message}` }];
  }
  return lost.map((r) => ({
    what: "orphan",
    ids: [String(r.id), String(r.parent)],
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
      `SELECT e.id, p.type FROM entity e LEFT JOIN place p ON p.id = e.id
        WHERE e.kind = 'places' AND p.lat IS NULL AND e.extent IS NULL
          AND coalesce(p.type, '') NOT IN (?, ?, ?)
        ORDER BY e.id`,
      ["celestial-body", "celestial-system", "realm"]
    );
  } catch (err) {
    return [{ what: "canon", said: `could not read places: ${(err as Error).message}` }];
  }
  return lost.map((r) => ({
    what: "unplaced",
    ids: [String(r.id)],
    said: `${r.id} is a ${r.type ?? "place"} with no position and no shape — the map cannot draw it`,
  }));
}

/** The one command every layer above the explorer reads the world with. */
function reader(): Wrong[] {
  return sqlite3()
    ? []
    : [{ what: "sqlite3", said: "no sqlite3 anywhere — every agent above the explorer is blind" }];
}

export const canonWrong = (): Wrong[] => [...calendar(), ...orphans(), ...unplaced()];

export function check(): Wrong[] {
  return [
    ...reader(),
    ...canonWrong(),
    ...agents(),
    ...machine.audit().map((said) => ({ what: "machine", said })),
    ...onDisk(),
  ];
}
