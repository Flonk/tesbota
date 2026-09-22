/**
 * What anybody outside the loop can ask the world to do. The web steers the CLI,
 * and these are the verbs it steers with.
 *
 * Every one of them returns a plain object; the CLI prints it as the last line of
 * stdout, which is the whole of the protocol between the two halves.
 */

import fs from "node:fs";
import path from "node:path";
import * as canon from "./canon.ts";
import * as db from "./db.ts";
import * as driver from "./driver.ts";
import * as prompts from "./prompts.ts";
import { ask } from "./agent.ts";
import { sqliteGate } from "./gate.ts";
import { MODELS, MYSTERY, STATE, WRITE_TOOLS } from "./config.ts";
import { edgeFrom, type StateName } from "./machine.ts";
import type { TurnT } from "./schema.ts";
import {
  loadCampaign, loadTurn, readJson, recordDeath, saveCampaign, saveTurn, writeJson,
} from "./state.ts";

const CHAT_FILE = path.join(STATE, "lore3.json");
const TALK_FILE = path.join(STATE, "lore4.json");

export const chatLog = (): any[] => (fs.existsSync(CHAT_FILE) ? readJson(CHAT_FILE) : []);

export function appendChat(role: string, text: string) {
  const log = chatLog();
  log.push({ role, text });
  writeJson(CHAT_FILE, log);
}

/**
 * Move the turn across one edge from outside the loop. The silence is settled by
 * a conversation, not by a step, and the two halves of it — you writing, and the
 * lore master answering — are two states that have to be written down as they
 * change hands or nothing watching can tell which of you is holding it.
 */
function hand(turn: TurnT, from: StateName, on: string): TurnT {
  turn.state = edgeFrom(from, on).to;
  driver.took(turn, from, on);
  saveTurn(turn);
  return turn;
}

const sitting = () =>
  fs.existsSync(TALK_FILE) ? readJson(TALK_FILE) : { session: null, log: [] };

export async function say(text: string) {
  const campaign = loadCampaign();
  if (!campaign.current_turn) return { error: "nothing is pending" };
  const turn = loadTurn(campaign.current_turn);
  // `lore3` here means an earlier answer was cut off mid-flight and left the turn
  // in the lore master's hands; asking again is how you take it back.
  if (turn.state !== "arbiter" && turn.state !== "lore3") {
    return { error: "nothing is pending" };
  }
  const session = (campaign.sessions as any).lore3_sitting;
  const message = session
    ? text
    : prompts.lore3Turn(turn.gap || "") + "\n\n" + text;
  appendChat("you", text);
  if (turn.state === "arbiter") hand(turn, "arbiter", "said");

  let reply: string;
  let next: unknown;
  try {
    [reply, next] = await ask(message, {
      system: prompts.LORE3_SYSTEM(),
      tools: WRITE_TOOLS,
      permission: sqliteGate({ readonly: false }),
      session,
      model: MODELS.lore3,
    });
  } catch (exc) {
    // Whatever went wrong, the turn does not stay in the hands of a layer that
    // is no longer answering — it goes back to you.
    hand(loadTurn(turn.turn_id), "lore3", "answered");
    throw exc;
  }

  const lines = reply.trim().split("\n").filter((l) => l.trim());
  let finished = !!lines.length && lines[lines.length - 1].trim() === "RESOLVED";
  const said = finished ? lines.slice(0, -1).join("\n").replace(/\s+$/, "") : reply;

  const held = loadCampaign();
  (held.sessions as any).lore3_sitting = next;
  saveCampaign(held);
  appendChat("lore master", said);

  const illegal = canon.illegalBooks();
  if (finished && illegal.length) {
    finished = false;
    const note =
      "Not resolved. These books are attributed to the one moving through this " +
      `world, which is not an author: ${illegal.join(", ")}. ` +
      "Direct observation is not testimony. Remove or reattribute them, then finish.";
    appendChat("driver", note);
    hand(loadTurn(held.current_turn!), "lore3", "answered");
    return { reply: said, resolved: false, rejected: note };
  }

  if (finished) await resolve();
  else hand(loadTurn(held.current_turn!), "lore3", "answered");
  return { reply: said, resolved: finished };
}

export async function talk(text: string) {
  const book = sitting();
  appendTalk("you", text);
  const [reply, session] = await ask(text, {
    system: prompts.LORE4_SYSTEM(),
    tools: WRITE_TOOLS,
    permission: sqliteGate({ readonly: false }),
    session: book.session,
    model: MODELS.lore4,
  });
  canon.linkWriting();
  const held = sitting();
  held.session = session;
  held.log.push({ role: "lore master", text: reply });
  writeJson(TALK_FILE, held);
  return { reply };
}

function appendTalk(role: string, text: string) {
  const held = sitting();
  held.log.push({ role, text });
  writeJson(TALK_FILE, held);
}

export function setNote(text: string | null) {
  const campaign = loadCampaign();
  campaign.note = String(text ?? "").trim() || null;
  saveCampaign(campaign);
  return { ok: true, note: campaign.note };
}

export async function resolve() {
  const campaign = loadCampaign();
  if (!campaign.current_turn) return { error: "nothing is pending" };
  let turn = loadTurn(campaign.current_turn);
  // Settling it yourself is you doing the lore master's half of it, so the turn
  // goes through the same state on its way out.
  if (turn.state === "arbiter") turn = hand(turn, "arbiter", "said");
  if (turn.state !== "lore3") return { error: "nothing is pending" };
  (campaign.sessions as any).lore3_sitting = null;
  saveCampaign(campaign);

  canon.linkWriting();

  const transcript = chatLog();
  if (transcript.length) (turn as any).lore = [...((turn as any).lore || []), ...transcript];
  (turn as any).lore_gap = turn.gap || (turn as any).lore_gap;

  driver.resolveGap(campaign, turn);
  writeJson(CHAT_FILE, []);

  try {
    const ran = await driver.run(1);
    return { ok: true, state: ran.state, turn: ran.turn.turn_id };
  } catch (exc) {
    const held = loadCampaign();
    return {
      ok: true,
      error: `${(exc as Error).name}: ${exc}`.slice(0, 600),
      turn: held.current_turn,
    };
  }
}

/**
 * Stop the clock turning the world over. Nothing in flight is lost — the next step
 * simply does not run until it is let go again.
 */
export function pause(on = true) {
  const campaign = loadCampaign();
  campaign.paused = !!on;
  saveCampaign(campaign);
  return { ok: true, paused: campaign.paused };
}

/**
 * How many minutes of world time pass in a minute of ours. 1 is real time; the
 * prototype runs thousands to the minute so a day's walk is not a day's wait.
 */
export function setSpeed(factor: unknown) {
  const campaign = loadCampaign();
  const clock = ((campaign as any).clock ||= {});
  clock.speed_factor = Math.max(1, Math.min(20000, Math.trunc(Number(factor))));
  saveCampaign(campaign);
  return { ok: true, speed: clock.speed_factor };
}

/**
 * Ask for a death. The driver carries it out, because the game master may be
 * calling for one in the middle of a turn that still has to be written.
 */
export const kill = (cause?: string | null) => ({ ok: true, cause: recordDeath(cause || MYSTERY) });

export async function step() {
  try {
    const ran = await driver.run(1);
    return { state: ran.state, turn: ran.turn.turn_id };
  } catch (exc) {
    const campaign = loadCampaign();
    return {
      error: `${(exc as Error).name}: ${exc}`.slice(0, 600),
      turn: campaign.current_turn,
    };
  }
}

/**
 * Set the shape of a place.
 *
 * The one way the map itself writes to the record. It checks the shape rather
 * than trusting it: a polygon that does not close, a point outside the world, a
 * run of one point — none of those are a place, and a map that saved them would
 * be quietly unreadable afterwards.
 */
export type Carry = { lon: number; lat: number } | null;

/** Every coordinate in a shape, moved by the same amount. */
function dragged(extent: string | null, by: { lon: number; lat: number }): string | null {
  let drawn: any;
  try {
    drawn = JSON.parse(String(extent));
  } catch {
    return null;
  }
  const walk = (node: any): any => {
    if (!Array.isArray(node)) return node;
    if (node.length === 2 && typeof node[0] === "number" && typeof node[1] === "number") {
      return [node[0] + by.lon, node[1] + by.lat];
    }
    return node.map(walk);
  };
  drawn.coordinates = walk(drawn.coordinates);
  return JSON.stringify(drawn);
}

export function shape(id: string, extent: unknown, carry: Carry = null) {
  const ident = String(id || "").trim().toLowerCase();
  if (!ident) return { error: "no place named" };

  const there = db.row("SELECT kind FROM entity WHERE id = ?", [ident]);
  if (!there) return { error: `no such place: ${ident}` };
  if (there.kind !== "places") return { error: `${ident} is not a place` };

  if (extent === null || extent === "") {
    db.writing((con) => con.prepare("UPDATE entity SET extent = NULL WHERE id = ?").run(ident));
    return { ok: true, id: ident, extent: null };
  }

  let drawn: any;
  try {
    drawn = typeof extent === "string" ? JSON.parse(extent) : extent;
  } catch {
    return { error: "that is not json" };
  }

  const KINDS = ["LineString", "Polygon", "MultiPolygon"];
  if (!drawn || !KINDS.includes(drawn.type)) {
    return { error: `a shape is one of ${KINDS.join(", ")}` };
  }

  const runs: number[][][] = [];
  const walk = (node: any) => {
    if (!Array.isArray(node)) return;
    if (node.length && Array.isArray(node[0]) && typeof node[0][0] === "number") {
      runs.push(node);
      return;
    }
    for (const child of node) walk(child);
  };
  walk(drawn.coordinates);
  if (!runs.length) return { error: "that shape has no points in it" };

  const shut = drawn.type !== "LineString";
  for (const run of runs) {
    if (run.length < (shut ? 4 : 2)) {
      return { error: shut ? "a ring needs three corners and a close" : "a run needs two points" };
    }
    for (const point of run) {
      const [lon, lat] = point;
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return { error: "a point is not a number" };
      if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
        return { error: `${lon}, ${lat} is off the world` };
      }
    }
    if (shut) {
      const [first, last] = [run[0], run[run.length - 1]];
      if (first[0] !== last[0] || first[1] !== last[1]) return { error: "a ring has to close" };
    }
  }

  const said = JSON.stringify(drawn);
  const before = db.value<string>("SELECT extent FROM entity WHERE id = ?", [ident]);
  db.writing((con) => con.prepare("UPDATE entity SET extent = ? WHERE id = ?").run(said, ident));

  // Ground picked up and set down elsewhere takes what stood on it. What counts
  // as standing on it is judged against where it was, not where it now is —
  // otherwise a shape moved clear of its own village would carry nothing.
  const carried: string[] = [];
  if (carry && (carry.lon || carry.lat)) {
    const held = ringsOf(before ?? null);
    if (held.length) {
      const inside = db
        .rows(
          `SELECT p.id, p.lat, p.lon, e.extent FROM place p JOIN entity e ON e.id = p.id
            WHERE p.id <> ? AND p.lat IS NOT NULL AND p.lon IS NOT NULL`,
          [ident]
        )
        .filter((r) => covers(held, Number(r.lon), Number(r.lat)));
      db.writing((con) => {
        for (const r of inside) {
          con
            .prepare("UPDATE place SET lat = ?, lon = ? WHERE id = ?")
            .run(Number(r.lat) + carry.lat, Number(r.lon) + carry.lon, r.id);
          const shifted = r.extent ? dragged(String(r.extent), carry) : null;
          if (shifted) {
            con.prepare("UPDATE entity SET extent = ? WHERE id = ?").run(shifted, r.id);
          }
          carried.push(String(r.id));
        }
      });
    }
  }

  // A shape that moved may now hold things it did not, or have let things go.
  const world = worldOf(ident);
  const moved = world ? restack(world) : [];

  return {
    ok: true, id: ident, extent: said,
    points: runs.reduce((n, r) => n + r.length, 0),
    carried,
    moved,
  };
}

const ringsOf = (extent: string | null): number[][][] => {
  let drawn: any;
  try {
    drawn = JSON.parse(String(extent));
  } catch {
    return [];
  }
  if (drawn?.type !== "Polygon" && drawn?.type !== "MultiPolygon") return [];
  const rings: number[][][] = [];
  const walk = (node: any) => {
    if (!Array.isArray(node)) return;
    if (node.length && Array.isArray(node[0]) && typeof node[0][0] === "number") {
      rings.push(node);
      return;
    }
    for (const child of node) walk(child);
  };
  walk(drawn.coordinates);
  return rings;
};

const covers = (rings: number[][][], lon: number, lat: number) => {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
};

const spread = (rings: number[][][]) => {
  let total = 0;
  for (const ring of rings) {
    let sum = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    }
    total += Math.abs(sum / 2);
  }
  return total;
};

/**
 * Put every place back inside whatever is actually drawn around it.
 *
 * What holds what stops being something anybody types and becomes something the
 * shapes say: a place belongs to the smallest ground that covers the point it is
 * named at. Draw a wall round a village and the houses inside it are its houses;
 * pull the wall in until a mill is outside and the mill belongs to the plain
 * again — both fall out of the one rule rather than being two cases.
 *
 * A place with nothing drawn around it falls back to the world it is on, because
 * everything on a world is at least on the world.
 */
export function restack(ground: string) {
  const all = db.rows(
    `WITH RECURSIVE under(id) AS (
       SELECT ?
       UNION
       SELECT p.id FROM place p JOIN under u ON p.parent = u.id
     )
     SELECT p.id, p.parent, p.type, p.lat, p.lon, e.extent
       FROM place p JOIN entity e ON e.id = p.id
      WHERE p.id IN (SELECT id FROM under) AND p.id <> ?`,
    [ground, ground]
  );

  const held = all.map((r) => ({
    id: String(r.id),
    parent: r.parent ?? null,
    type: r.type ?? null,
    lat: r.lat === null || r.lat === undefined ? null : Number(r.lat),
    lon: r.lon === null || r.lon === undefined ? null : Number(r.lon),
    rings: ringsOf(r.extent ?? null),
  }));
  const by = new Map(held.map((p) => [p.id, p]));

  const moved: Array<{ id: string; from: string | null; to: string }> = [];
  const wanted = new Map<string, string>();

  for (const place of held) {
    if (place.lat === null || place.lon === null) continue;
    let best: { id: string; size: number } | null = null;
    for (const other of held) {
      if (other.id === place.id || !other.rings.length) continue;
      if (!covers(other.rings, place.lon, place.lat)) continue;
      const size = spread(other.rings);
      if (!best || size < best.size) best = { id: other.id, size };
    }
    wanted.set(place.id, best?.id ?? ground);
  }

  // A shape drawn inside a shape it already holds would make a ring of parents,
  // and a world where everywhere is inside everywhere is nowhere at all.
  const loops = (id: string, parent: string) => {
    const seen = new Set([id]);
    let at: string | null = parent;
    for (let n = 0; at && n < 64; n++) {
      if (seen.has(at)) return true;
      seen.add(at);
      at = wanted.get(at) ?? by.get(at)?.parent ?? null;
    }
    return false;
  };

  db.writing((con) => {
    for (const [id, parent] of wanted) {
      const place = by.get(id)!;
      if (place.parent === parent || loops(id, parent)) continue;
      con.prepare("UPDATE place SET parent = ? WHERE id = ?").run(parent, id);
      moved.push({ id, from: place.parent, to: parent });
    }
  });
  return moved;
}

/** The world a place is on, however deep it sits. */
export function worldOf(id: string): string | null {
  const found = db.row(
    `WITH RECURSIVE up(id, depth) AS (
       SELECT ?, 0
       UNION
       SELECT p.parent, up.depth + 1 FROM place p JOIN up ON p.id = up.id
        WHERE up.depth < 32 AND p.parent IS NOT NULL
     )
     SELECT up.id FROM up JOIN place p ON p.id = up.id
      WHERE p.type = 'celestial-body' ORDER BY up.depth LIMIT 1`,
    [id]
  );
  return found ? String(found.id) : null;
}
