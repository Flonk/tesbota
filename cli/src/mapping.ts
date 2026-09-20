/**
 * Where everything is.
 *
 * The world writes down bearings and distances, not coordinates, so the map is
 * solved rather than stored: lay the graph out by following what the record says,
 * then relax it until the bearings and the distances are as satisfied as they can
 * both be. It is seeded, so the same world always solves the same way.
 *
 * A place is `fixed` if somebody surveyed it, `constrained` if a road or a child
 * pins it, and `floating` if the world has only ever named it.
 *
 * Surveyed means `lat`/`lon` on the place, or the middle of the shape in `extent`.
 * The record keeps those in degrees and the roads are in metres, so the two are
 * brought together on a plane laid flat against the world at the middle of
 * everything anybody has fixed — near enough over the distances a life walks, and
 * the only place in here that needs to know the world is round.
 */

import * as db from "./db.ts";
import * as travel from "./travel.ts";
import { seeded as seededRng, type Rng } from "./rng.ts";
import { allTurns, campaignIfAny, loadCampaign, saveCampaign } from "./state.ts";

export const SEED = 1729;
export const ROUNDS = 600;
const NOMINAL = 600.0;
const MIN_GAP = 140.0;
const NUDGE = 0.35;
const PULL = 0.2;

export type Place = {
  name: string;
  extent: string | null;
  lat: number | null;
  lon: number | null;
  parent: string | null;
  children: string[];
};

/** Metres to a degree of latitude; longitude shrinks by the cosine of where you are. */
export const PER_DEGREE = 111320;

export type Anchor = { lat: number; lon: number };

export type Road = {
  src: string; dst: string; bearing: string; distance: string;
  degrees: number | null; band: [number, number] | null;
};

export function places(): Record<string, Place> {
  const known: Record<string, Place> = {};
  for (const r of db.rows(
    `SELECT e.id, e.name, e.extent, p.lat, p.lon
       FROM entity e LEFT JOIN place p ON p.id = e.id
      WHERE e.kind = 'places' ORDER BY e.id`
  )) {
    known[String(r.id)] = {
      name: String(r.name), extent: r.extent ?? null,
      lat: r.lat ?? null, lon: r.lon ?? null,
      parent: null, children: [],
    };
  }
  for (const r of db.rows("SELECT id AS src, parent AS dst FROM place WHERE parent IS NOT NULL ORDER BY id")) {
    const src = String(r.src);
    const dst = String(r.dst);
    if (known[src] && known[dst] && src !== dst) {
      known[src].parent = dst;
      known[dst].children.push(src);
    }
  }
  return known;
}

export function roads(known: Record<string, Place>): Road[] {
  const out: Road[] = [];
  for (const r of db.rows("SELECT src, dst, bearing, distance FROM way ORDER BY src, dst")) {
    const src = String(r.src);
    const dst = String(r.dst);
    if (!known[src] || !known[dst]) continue;
    out.push({
      src, dst,
      bearing: String(r.bearing || ""),
      distance: String(r.distance || ""),
      degrees: travel.bearingDegrees(r.bearing) ?? null,
      band: travel.distanceBand(r.distance),
    });
  }
  return out;
}

/**
 * The middle of a measured shape, in degrees — GeoJSON writes a point as
 * `[lon, lat]` and this hands it back the same way round.
 */
export function centre(extent: string | null): [number, number] | null {
  let shape: any;
  try {
    shape = JSON.parse(String(extent));
  } catch {
    return null;
  }
  const points: Array<[number, number]> = [];
  const walk = (node: any) => {
    if (!Array.isArray(node)) return;
    if (node.length === 2 && node.every((v) => typeof v === "number")) {
      points.push([node[0], node[1]]);
      return;
    }
    for (const child of node) walk(child);
  };
  walk(shape?.coordinates);
  if (!points.length) return null;
  return [
    points.reduce((a, p) => a + p[0], 0) / points.length,
    points.reduce((a, p) => a + p[1], 0) / points.length,
  ];
}

/** Where a place says it is, in degrees, however it says it. */
export function degrees(place: Place): Anchor | null {
  if (place.lat != null && place.lon != null) return { lat: place.lat, lon: place.lon };
  const middle = centre(place.extent);
  return middle ? { lon: middle[0], lat: middle[1] } : null;
}

/** The middle of everything surveyed, which is where the plane touches the world. */
export function anchor(known: Record<string, Place>): Anchor | null {
  const fixed = Object.keys(known).sort().map((i) => degrees(known[i])).filter(Boolean) as Anchor[];
  if (!fixed.length) return null;
  return {
    lat: fixed.reduce((a, p) => a + p.lat, 0) / fixed.length,
    lon: fixed.reduce((a, p) => a + p.lon, 0) / fixed.length,
  };
}

export const flatten = (at: Anchor, on: Anchor): [number, number] => [
  (on.lon - at.lon) * PER_DEGREE * Math.cos((at.lat * Math.PI) / 180),
  (on.lat - at.lat) * PER_DEGREE,
];

export const round = (at: Anchor, x: number, y: number): Anchor => ({
  lat: at.lat + y / PER_DEGREE,
  lon: at.lon + x / (PER_DEGREE * Math.cos((at.lat * Math.PI) / 180)),
});

/** Everywhere the record actually fixes, in metres on the plane. */
export function pinned(known: Record<string, Place>, at: Anchor | null) {
  const out: Record<string, [number, number]> = {};
  if (!at) return out;
  for (const [ident, place] of Object.entries(known)) {
    const said = degrees(place);
    if (said) out[ident] = flatten(at, said);
  }
  return out;
}

const heading = (degrees: number): [number, number] => {
  const rad = (degrees * Math.PI) / 180;
  return [Math.sin(rad), Math.cos(rad)];
};

export function anchors(edges: Road[]): Set<string> {
  const out = new Set<string>();
  for (const e of edges) {
    if (e.degrees !== null || e.band) {
      out.add(e.src);
      out.add(e.dst);
    }
  }
  return out;
}

export function confidences(
  known: Record<string, Place>, edges: Road[], at: Anchor | null = anchor(known)
): Record<string, string> {
  const anchored = anchors(edges);
  const fixed = pinned(known, at);
  const out: Record<string, string> = {};
  for (const ident of Object.keys(known)) {
    if (fixed[ident]) out[ident] = "fixed";
    else if (anchored.has(ident)) out[ident] = "constrained";
  }
  // A parent whose child is pinned is pinned by it, and that spreads upward —
  // which needs running to a fixed point, not once, or a grandparent stays adrift.
  let spreading = true;
  while (spreading) {
    spreading = false;
    for (const [ident, place] of Object.entries(known)) {
      if (out[ident]) continue;
      if (place.children.some((kid) => out[kid])) {
        out[ident] = "constrained";
        spreading = true;
      }
    }
  }
  for (const ident of Object.keys(known)) out[ident] ??= "floating";
  return out;
}

/**
 * Lay the graph out once by following its bearings, so relaxation starts from
 * something already roughly right.
 */
export function seed(
  known: Record<string, Place>, edges: Road[], confidence: Record<string, string>, rng: Rng,
  anchored: Anchor | null = anchor(known)
): Record<string, [number, number]> {
  const at: Record<string, [number, number]> = { ...pinned(known, anchored) };

  const out: Record<string, Road[]> = {};
  for (const e of edges) {
    (out[e.src] ||= []).push(e);
    (out[e.dst] ||= []).push({
      ...e, src: e.dst, dst: e.src,
      degrees: e.degrees === null ? null : (e.degrees + 180) % 360,
    });
  }

  const placed = Object.keys(known).sort().filter((i) => confidence[i] !== "floating");
  for (const start of placed) {
    if (at[start]) continue;
    at[start] = [0, 0];
    const queue = [start];
    while (queue.length) {
      const here = queue.shift()!;
      for (const e of out[here] || []) {
        if (at[e.dst] || confidence[e.dst] === "floating") continue;
        const span = e.band ? (e.band[0] + e.band[1]) / 2 : NOMINAL;
        const step = e.degrees === null
          ? (() => {
              const angle = rng.next() * 2 * Math.PI;
              return [Math.sin(angle), Math.cos(angle)] as [number, number];
            })()
          : heading(e.degrees);
        at[e.dst] = [at[here][0] + step[0] * span, at[here][1] + step[1] * span];
        queue.push(e.dst);
      }
    }
  }

  for (const ident of placed) {
    if (at[ident]) continue;
    const angle = rng.next() * 2 * Math.PI;
    at[ident] = [Math.sin(angle) * NOMINAL * 3, Math.cos(angle) * NOMINAL * 3];
  }
  return at;
}

function shift(
  at: Record<string, [number, number]>, fixed: Set<string>,
  a: string, b: string, dx: number, dy: number
) {
  if (fixed.has(a) && fixed.has(b)) return;
  if (fixed.has(a)) {
    at[b][0] += dx;
    at[b][1] += dy;
    return;
  }
  if (fixed.has(b)) {
    at[a][0] -= dx;
    at[a][1] -= dy;
    return;
  }
  at[a][0] -= dx / 2;
  at[a][1] -= dy / 2;
  at[b][0] += dx / 2;
  at[b][1] += dy / 2;
}

export function relax(
  at: Record<string, [number, number]>, known: Record<string, Place>,
  edges: Road[], confidence: Record<string, string>, rounds: number
) {
  const fixed = new Set(Object.entries(confidence).filter(([, c]) => c === "fixed").map(([i]) => i));
  const anchored = anchors(edges);
  const live = edges.filter((e) => at[e.src] && at[e.dst]);
  const ids = Object.keys(at).sort();

  for (let round = 0; round < rounds; round++) {
    for (const e of live) {
      const { src: a, dst: b } = e;
      let vx = at[b][0] - at[a][0];
      let vy = at[b][1] - at[a][1];
      let span = Math.hypot(vx, vy) || 1e-6;

      if (e.degrees !== null) {
        const [sx, sy] = heading(e.degrees);
        shift(at, fixed, a, b, (sx * span - vx) * NUDGE, (sy * span - vy) * NUDGE);
        vx = at[b][0] - at[a][0];
        vy = at[b][1] - at[a][1];
        span = Math.hypot(vx, vy) || 1e-6;
      }

      if (e.band) {
        const [low, high] = e.band;
        const want = Math.min(Math.max(span, low), high);
        const grow = ((want - span) / span) * NUDGE;
        shift(at, fixed, a, b, vx * grow, vy * grow);
      }
    }

    for (const ident of ids) {
      if (fixed.has(ident) || anchored.has(ident)) continue;
      const kids = known[ident].children.filter((k) => at[k]);
      if (!kids.length) continue;
      const mx = kids.reduce((s, k) => s + at[k][0], 0) / kids.length;
      const my = kids.reduce((s, k) => s + at[k][1], 0) / kids.length;
      at[ident][0] += (mx - at[ident][0]) * PULL;
      at[ident][1] += (my - at[ident][1]) * PULL;
    }

    for (let n = 0; n < ids.length; n++) {
      for (let m = n + 1; m < ids.length; m++) {
        const a = ids[n];
        const b = ids[m];
        let vx = at[b][0] - at[a][0];
        let vy = at[b][1] - at[a][1];
        let span = Math.hypot(vx, vy);
        if (span >= MIN_GAP) continue;
        if (span < 1e-6) {
          vx = MIN_GAP;
          vy = 0;
          span = MIN_GAP;
        }
        const push = ((MIN_GAP - span) / span) * 0.25;
        shift(at, fixed, a, b, vx * push, vy * push);
      }
    }
  }
  return at;
}

/**
 * Everywhere the explorer has actually stood. The turn records are read once and
 * the answer is kept on the campaign.
 */
export function walked(): Set<string> {
  const campaign = campaignIfAny();
  if (!campaign) return new Set();
  const seen = new Set<string>(((campaign as any).walked || []) as string[]);
  const mark = String((campaign as any).walked_through || "");
  let latest = mark;
  for (const turn of allTurns()) {
    if (turn.turn_id <= mark) continue;
    if (turn.turn_id > latest) latest = turn.turn_id;
    for (const step of (turn.location_path || []) as any[]) {
      const ident = step && typeof step === "object" ? step.id : step;
      if (ident) seen.add(String(ident));
    }
  }

  const before = new Set<string>(((campaign as any).walked || []) as string[]);
  const moved = latest !== mark || seen.size !== before.size;
  if (moved) {
    const fresh = loadCampaign();
    (fresh as any).walked = [...seen].sort();
    (fresh as any).walked_through = latest;
    saveCampaign(fresh);
  }
  return seen;
}

export const knowledge = (ident: string, been: Set<string>) =>
  been.has(ident) ? "walked" : "recorded";

export function solve(seedWith = SEED, rounds = ROUNDS) {
  const known = places();
  const edges = roads(known);
  const at = anchor(known);
  const confidence = confidences(known, edges, at);
  const solved = relax(
    seed(known, edges, confidence, seededRng(seedWith), at), known, edges, confidence, rounds
  );
  const out: Record<string, any> = {};
  for (const ident of Object.keys(known).sort()) {
    const here = solved[ident];
    const back = here && at ? round(at, here[0], here[1]) : null;
    out[ident] = {
      x: here ? Number(here[0].toFixed(3)) : null,
      y: here ? Number(here[1].toFixed(3)) : null,
      lat: back ? Number(back.lat.toFixed(6)) : null,
      lon: back ? Number(back.lon.toFixed(6)) : null,
      fixed: confidence[ident] === "fixed",
      confidence: confidence[ident],
    };
  }
  return out;
}

export function layout(seedWith = SEED, rounds = ROUNDS) {
  const known = places();
  const solved = solve(seedWith, rounds);
  const been = walked();
  const out: Record<string, any> = {};
  for (const ident of Object.keys(solved)) {
    out[ident] = {
      name: known[ident].name,
      parent: known[ident].parent,
      children: [...known[ident].children].sort(),
      extent: known[ident].extent,
      knowledge: knowledge(ident, been),
      ...solved[ident],
    };
  }
  return {
    seed: seedWith,
    anchor: anchor(known),
    places: out,
    roads: roads(known),
    floating: Object.entries(solved).filter(([, m]) => m.confidence === "floating").map(([i]) => i),
  };
}
