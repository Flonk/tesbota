/**
 * What is around a place, and how to get from one place to another — read off the
 * map itself. The shapes are the record: a road is where its line runs, a village
 * is where its outline is, and nothing about where things lie is written down twice.
 *
 * Doors are the one thing a map cannot show: the inside of a building, a cellar, a
 * way into somewhere that is not on the ground at all. Those are the only rows the
 * `way` table still holds, and a route may step through one for nothing.
 */

import * as db from "./db.ts";
import {
  area, bearing, closest, covers, gap, metres, page, pinOf, point16, shapeOf, type Pt, type Shape,
} from "./geo.ts";
import { ancestry, placesUnder, worldOf, type PlaceRow } from "./places.ts";
import { campaignIfAny } from "./state.ts";
import type { CampaignT } from "./schema.ts";

const EARTH = 6371000;
const LEAGUE = 4800;
const ACROSS_COUNTRY = 1.6;
const JOIN = 60;

type Spot = PlaceRow & Shape;

const radiusOf = (world: string | null) =>
  Number(world ? db.value("SELECT radius FROM orbit WHERE id = ?", [world], null) : null) || EARTH;

function placesOn(world: string): Spot[] {
  return placesUnder(world)
    .filter((p) => !["celestial-body", "celestial-system", "realm"].includes(p.type ?? ""))
    .map((p) => ({ ...p, ...shapeOf(p.extent) }));
}

function spoken(m: number) {
  if (m < 1000) return `${Math.max(1, Math.round(m / 10) * 10)} m`;
  if (m < 10000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 1000)} km`;
}

export function standsAt(campaign: CampaignT | null): string | null {
  if (!campaign?.position) return campaign?.location ?? null;
  const [lon, lat] = campaign.position;
  return `${lat.toFixed(6)},${lon.toFixed(6)}`;
}

type Where = { world: string; all: Spot[]; at: Pt; spot: Spot | null; said: string };

/** A place id, `lat,lon`, or nothing for wherever the explorer is standing. */
function resolve(target: string | null | undefined): Where | { error: string } {
  let text = String(target ?? "").trim();
  if (!text) {
    const here = standsAt(campaignIfAny());
    if (!here) return { error: "nobody is standing anywhere yet — name a place or give lat,lon" };
    text = here;
  }
  const pair = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(text);
  if (pair) {
    const lat = Number(pair[1]);
    const lon = Number(pair[2]);
    const near = campaignIfAny()?.location;
    const world = (near && worldOf(String(near))) ||
      String(db.value("SELECT id FROM place WHERE type = 'celestial-body' ORDER BY id LIMIT 1", [], "") || "");
    if (!world) return { error: "there is no world to stand on" };
    return { world, all: placesOn(world), at: [lon, lat], spot: null, said: `${lat.toFixed(5)}, ${lon.toFixed(5)}` };
  }
  const id = text.toLowerCase();
  const world = worldOf(id);
  if (!world) return { error: `${id} is not a place on any world` };
  const all = placesOn(world);
  const spot = all.find((s) => s.id === id);
  if (!spot) return { error: `${id} is not a place on the ground` };
  const at = pinOf(spot);
  if (!at) return { error: `${spot.name} has no position and no shape — the map cannot say where it is` };
  return { world, all, at, spot, said: spot.name };
}

function doorsOf(id: string | null) {
  if (!id) return [];
  return db
    .rows(
      `SELECT w.dst AS id, coalesce(e.name, w.dst) AS name FROM way w LEFT JOIN entity e ON e.id = w.dst
        WHERE w.src = ? ORDER BY w.dst`,
      [id]
    )
    .map((r) => ({ id: String(r.id), name: String(r.name) }));
}

/** Everything within reach of a place or a point, nearest first, and which way it lies. */
export function around(target?: string | null, within = 3000, most = 16) {
  const where = resolve(target);
  if ("error" in where) return where;
  const { all } = where;
  const radius = radiusOf(where.world);
  const flat = page(where.at, radius);
  const me = flat.to(where.at);
  const byId = new Map(all.map((s) => [s.id, s]));

  const standing = all
    .filter((s) => s.id !== where.spot?.id && s.rings.length && covers(s.rings, where.at))
    .sort((a, b) => area(a.rings) - area(b.rings))
    .map((s) => ({ id: s.id, name: s.name, type: s.type }));
  const inside = new Set(standing.map((s) => s.id));

  const near = [];
  for (const s of all) {
    if (s.id === where.spot?.id || inside.has(s.id)) continue;
    const runs = s.line?.length ? [s.line] : s.rings;
    const hit = closest(runs, where.at, flat);
    const pin = hit ? null : pinOf(s);
    const reach = hit ?? (pin && { d: gap(flat.to(pin), me), q: pin });
    if (!reach || reach.d > within) continue;
    const m = Math.round(reach.d);
    const heading = hit && s.line?.length
      ? bearing(s.line[hit.seg], s.line[Math.min(s.line.length - 1, hit.seg + 1)])
      : null;
    near.push({
      id: s.id, name: s.name, type: s.type,
      metres: m,
      bearing: m < 1 ? null : point16(bearing(where.at, reach.q)),
      ...(heading === null ? {} : { runs: `${point16(heading)}–${point16((heading + 180) % 360)}` }),
      edge: !!s.rings.length,
    });
  }
  near.sort((a, b) => a.metres - b.metres);

  const leads: Array<{ id: string; name: string; bearing: string; metres: number }> = [];
  if (where.spot?.line && where.spot.line.length >= 2) {
    const run = where.spot.line;
    for (const end of [run[0], run[run.length - 1]]) {
      let best: { s: Spot; d: number } | null = null;
      const holding = all
        .filter((s) => s.type === "location" && s.rings.length && covers(s.rings, end))
        .sort((a, b) => area(b.rings) - area(a.rings))[0];
      if (holding) best = { s: holding, d: 0 };
      for (const s of holding ? [] : all) {
        if (s.id === where.spot.id || s.line || (s.type !== "location" && s.type !== "water")) continue;
        const pin = pinOf(s);
        if (!pin) continue;
        const d = metres(end, pin, radius);
        if (d < 2000 && (!best || d < best.d)) best = { s, d };
      }
      for (let up = best && byId.get(best.s.parent ?? ""); best && up && up.type === "location"; up = byId.get(up.parent ?? "")) {
        best = { s: up, d: best.d };
      }
      if (best && !leads.some((l) => l.id === best!.s.id)) {
        leads.push({
          id: best.s.id, name: best.s.name,
          bearing: point16(bearing(where.at, end)),
          metres: Math.round(metres(where.at, end, radius)),
        });
      }
    }
  }

  const contains = where.spot
    ? all.filter((s) => s.parent === where.spot!.id).map((s) => ({ id: s.id, name: s.name, type: s.type }))
    : [];

  return {
    at: where.said,
    id: where.spot?.id ?? null,
    type: where.spot?.type ?? null,
    lat: Number(where.at[1].toFixed(6)),
    lon: Number(where.at[0].toFixed(6)),
    within: where.spot ? ancestry(where.spot.id).slice(0, -1).reverse().map((a) => a.name) : [],
    standing,
    contains,
    near: near.slice(0, most),
    doors: doorsOf(where.spot?.id ?? null),
    leads,
  };
}

type Edge = { to: number; m: number; cost: number; by: string; name: string };

/**
 * The way from one place to another over the roads, and across country where no
 * road goes. Walking off a road costs more than walking on one, so a route takes
 * the road when the road is anywhere near worth it, and says plainly when it is not.
 */
export function route(fromTarget: string | null | undefined, toTarget: string) {
  const a = resolve(fromTarget);
  if ("error" in a) return a;
  const b = resolve(toTarget);
  if ("error" in b) return b;
  if (a.world !== b.world) return { error: `${a.said} and ${b.said} are not on the same world` };
  const radius = radiusOf(a.world);
  const { all } = a;
  const middle: Pt = [(a.at[0] + b.at[0]) / 2, (a.at[1] + b.at[1]) / 2];
  const flat = page(middle, radius);

  const nodes: Pt[] = [];
  const edges: Edge[][] = [];
  const node = (p: Pt) => {
    nodes.push(p);
    edges.push([]);
    return nodes.length - 1;
  };
  const link = (i: number, j: number, by: string, name: string, slow = 1) => {
    const m = metres(nodes[i], nodes[j], radius);
    edges[i].push({ to: j, m, cost: m * slow, by, name });
    edges[j].push({ to: i, m, cost: m * slow, by, name });
  };

  const roads = all.filter((s) => s.type === "road" && s.line && s.line.length >= 2);
  const cuts = new Map<string, Array<{ seg: number; t: number; p: Pt; n?: number }>>();
  for (const r of roads) cuts.set(r.id, r.line!.map((p, i) => ({ seg: i, t: 0, p })));
  const cut = (road: Spot, seg: number, t: number, p: Pt) => {
    const at = { seg, t, p, n: node(p) };
    cuts.get(road.id)!.push(at);
    return at.n!;
  };

  for (const r of roads) for (const p of cuts.get(r.id)!) p.n = node(p.p);

  for (let i = 0; i < roads.length; i++) {
    for (let j = 0; j < roads.length; j++) {
      if (i === j) continue;
      for (const own of cuts.get(roads[i].id)!.filter((c) => c.t === 0)) {
        const hit = closest([roads[j].line!], own.p, flat);
        if (!hit || hit.d > JOIN) continue;
        link(own.n!, cut(roads[j], hit.seg, hit.t, hit.q), "join", "");
      }
    }
  }

  const start = node(a.at);
  const end = node(b.at);
  for (const [n, p] of [[start, a.at], [end, b.at]] as Array<[number, Pt]>) {
    for (const r of roads) {
      const hit = closest([r.line!], p, flat);
      if (hit) link(n, cut(r, hit.seg, hit.t, hit.q), "off", "", ACROSS_COUNTRY);
    }
  }
  link(start, end, "off", "", ACROSS_COUNTRY);

  for (const r of roads) {
    const along = cuts.get(r.id)!.sort((x, y) => x.seg - y.seg || x.t - y.t);
    for (let k = 1; k < along.length; k++) link(along[k - 1].n!, along[k].n!, "road", r.name);
  }

  const byId = new Map(all.map((s) => [s.id, s]));
  for (const w of db.rows("SELECT src, dst FROM way")) {
    const from = byId.get(String(w.src));
    const to = byId.get(String(w.dst));
    const p = from && pinOf(from);
    const q = to && pinOf(to);
    if (!p || !q) continue;
    const i = node(p);
    const j = node(q);
    edges[i].push({ to: j, m: 0, cost: 0, by: "door", name: to!.name });
    link(i, nearestNode(p), "join", "");
    link(j, nearestNode(q), "join", "");
  }
  function nearestNode(p: Pt) {
    let best = start;
    let least = metres(nodes[best], p, radius);
    for (let n = 0; n < nodes.length - 2; n++) {
      const d = metres(nodes[n], p, radius);
      if (d < least) [best, least] = [n, d];
    }
    return best;
  }

  const cost = new Array(nodes.length).fill(Infinity);
  const back: Array<{ from: number; edge: Edge } | null> = new Array(nodes.length).fill(null);
  const done = new Array(nodes.length).fill(false);
  cost[start] = 0;
  for (;;) {
    let u = -1;
    for (let n = 0; n < nodes.length; n++) if (!done[n] && cost[n] < Infinity && (u < 0 || cost[n] < cost[u])) u = n;
    if (u < 0 || u === end) break;
    done[u] = true;
    for (const e of edges[u]) {
      if (cost[u] + e.cost < cost[e.to]) {
        cost[e.to] = cost[u] + e.cost;
        back[e.to] = { from: u, edge: e };
      }
    }
  }
  if (cost[end] === Infinity) return { error: `no way from ${a.said} to ${b.said}` };

  const steps: Array<{ from: number; to: number; edge: Edge }> = [];
  for (let n = end; back[n]; n = back[n]!.from) steps.unshift({ from: back[n]!.from, to: n, edge: back[n]!.edge });

  const legs: Array<{ by: string; name: string; metres: number; from: Pt; to: Pt }> = [];
  for (const s of steps) {
    const by = s.edge.by === "join" ? (legs.at(-1)?.by ?? "off") : s.edge.by;
    const name = s.edge.by === "join" ? (legs.at(-1)?.name ?? "") : s.edge.name;
    const last = legs.at(-1);
    if (last && last.by === by && last.name === name) {
      last.metres += s.edge.m;
      last.to = nodes[s.to];
    } else {
      legs.push({ by, name, metres: s.edge.m, from: nodes[s.from], to: nodes[s.to] });
    }
  }

  const said = legs
    .filter((l) => l.metres >= 1 || l.by === "door")
    .map((l) => {
      const way = point16(bearing(l.from, l.to));
      if (l.by === "door") return { by: "door", name: l.name, metres: 0, said: `go through into ${l.name}` };
      if (l.by === "road") return { by: "road", name: l.name, metres: Math.round(l.metres), said: `follow ${l.name} ${way} for ${spoken(l.metres)}` };
      return { by: "across", name: "", metres: Math.round(l.metres), said: `go ${spoken(l.metres)} ${way} across country` };
    });
  const total = said.reduce((n, l) => n + l.metres, 0);
  const path: Pt[] = [nodes[start], ...steps.map((s) => nodes[s.to])]
    .filter((p, n, all) => n === 0 || p[0] !== all[n - 1][0] || p[1] !== all[n - 1][1]);
  return {
    path,
    from: a.said,
    to: b.said,
    to_id: b.spot?.id ?? null,
    metres: total,
    said: spoken(total),
    leagues: Number((total / LEAGUE).toFixed(2)),
    straight: spoken(metres(a.at, b.at, radius)),
    legs: said,
  };
}

/** The same, as a few lines anybody can read. */
export function tellAround(found: ReturnType<typeof around>): string {
  if ("error" in found) return found.error;
  const out: string[] = [];
  out.push(`${found.at}${found.type ? ` (${found.type})` : ""}${found.within.length ? `, in ${found.within.join(", in ")}` : ""}`);
  out.push(`  at ${found.lat}, ${found.lon}`);
  if (found.standing.length) out.push(`  standing inside: ${found.standing.map((s) => s.name).join(", ")}`);
  if (found.contains.length) out.push(`  holds: ${found.contains.map((s) => s.name).join(", ")}`);
  if (found.doors.length) out.push(`  doors: ${found.doors.map((d) => d.name).join(", ")}`);
  if (found.leads.length) out.push(`  leads to: ${found.leads.map((l) => `${l.name} (${spoken(l.metres)} ${l.bearing})`).join(", ")}`);
  if (found.near.length) {
    out.push("  nearby:");
    for (const n of found.near) {
      const where = n.metres < 1 ? "right here" : `${spoken(n.metres)} ${n.bearing}${n.edge ? " (to its edge)" : ""}`;
      out.push(`    ${n.name} — ${n.type ?? "place"}, ${where}${n.runs ? `, runs ${n.runs}` : ""}`);
    }
  } else {
    out.push("  nothing written down within reach");
  }
  return out.join("\n");
}

export function tellRoute(found: ReturnType<typeof route>): string {
  if ("error" in found) return found.error;
  const out = [`${found.from} to ${found.to}: ${found.said} (${found.leagues} leagues; ${found.straight} as the crow flies)`];
  found.legs.forEach((l, n) => out.push(`  ${n + 1}. ${l.said}`));
  if (found.to_id) out.push(`  commit it as {"destination": "${found.to_id}"}`);
  return out.join("\n");
}
