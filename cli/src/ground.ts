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
import { POINTS } from "./travel.ts";
import { campaignIfAny } from "./state.ts";
import type { CampaignT, PtT } from "./schema.ts";

const EARTH = 6371000;
const LEAGUE = 4800;
const ACROSS_COUNTRY = 1.6;
const JOIN = 60;

type Spot = {
  id: string; name: string; type: string | null; parent: string | null;
  lat: number | null; lon: number | null; rings: PtT[][]; line: PtT[] | null;
};

const RAD = Math.PI / 180;

function worldOf(id: string): string | null {
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

const radiusOf = (world: string | null) =>
  Number(world ? db.value("SELECT radius FROM orbit WHERE id = ?", [world], null) : null) || EARTH;

function shapeOf(extent: string | null): { rings: PtT[][]; line: PtT[] | null } {
  let drawn: any;
  try {
    drawn = JSON.parse(String(extent));
  } catch {
    return { rings: [], line: null };
  }
  if (drawn?.type === "LineString") return { rings: [], line: drawn.coordinates };
  const rings: PtT[][] = [];
  const walk = (node: any) => {
    if (!Array.isArray(node)) return;
    if (node.length && Array.isArray(node[0]) && typeof node[0][0] === "number") rings.push(node);
    else node.forEach(walk);
  };
  if (drawn?.type === "Polygon" || drawn?.type === "MultiPolygon") walk(drawn.coordinates);
  return { rings, line: null };
}

function placesOn(world: string): Spot[] {
  return db
    .rows(
      `WITH RECURSIVE under(id) AS (
         SELECT ?
         UNION
         SELECT p.id FROM place p JOIN under u ON p.parent = u.id
       )
       SELECT p.id, e.name, p.type, p.parent, p.lat, p.lon, e.extent
         FROM place p JOIN entity e ON e.id = p.id
        WHERE p.id IN (SELECT id FROM under) AND p.id <> ?
          AND coalesce(p.type, '') NOT IN ('celestial-body', 'celestial-system', 'realm')`,
      [world, world]
    )
    .map((r) => ({
      id: String(r.id),
      name: String(r.name),
      type: r.type ?? null,
      parent: r.parent ?? null,
      lat: r.lat === null || r.lat === undefined ? null : Number(r.lat),
      lon: r.lon === null || r.lon === undefined ? null : Number(r.lon),
      ...shapeOf(r.extent ?? null),
    }));
}

/** A flat page of metres around one point, good for the few kilometres a walk spans. */
function page(origin: PtT, radius: number) {
  const k = (2 * Math.PI * radius) / 360;
  const c = Math.cos(origin[1] * RAD);
  return {
    to: ([lon, lat]: PtT): PtT => [(lon - origin[0]) * k * c, (lat - origin[1]) * k],
    from: ([x, y]: PtT): PtT => [origin[0] + x / (k * c), origin[1] + y / k],
  };
}

const gap = (a: PtT, b: PtT) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Great-circle metres, so a long road is not measured on a flat page. */
function metres(a: PtT, b: PtT, radius: number) {
  const dLat = (b[1] - a[1]) * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

function bearing(a: PtT, b: PtT) {
  const y = Math.sin((b[0] - a[0]) * RAD) * Math.cos(b[1] * RAD);
  const x = Math.cos(a[1] * RAD) * Math.sin(b[1] * RAD) -
    Math.sin(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.cos((b[0] - a[0]) * RAD);
  return ((Math.atan2(y, x) / RAD) + 360) % 360;
}

const point16 = (deg: number) => POINTS[Math.round(deg / 22.5) % 16];

function spoken(m: number) {
  if (m < 1000) return `${Math.max(1, Math.round(m / 10) * 10)} m`;
  if (m < 10000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 1000)} km`;
}

function covers(rings: PtT[][], [x, y]: PtT) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function area(rings: PtT[][]) {
  let total = 0;
  for (const ring of rings) {
    let sum = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    total += Math.abs(sum / 2);
  }
  return total;
}

/** The nearest point of a run of points, in page metres: where, how far, which segment, how far along it. */
function nearest(run: PtT[], p: PtT) {
  let best = { q: run[0], d: gap(run[0], p), seg: 0, t: 0 };
  for (let i = 1; i < run.length; i++) {
    const a = run[i - 1];
    const b = run[i];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
    const q: PtT = [a[0] + t * dx, a[1] + t * dy];
    const d = gap(q, p);
    if (d < best.d) best = { q, d, seg: i - 1, t };
  }
  return best;
}

function interior(rings: PtT[][]): PtT | null {
  const ring = rings[0];
  if (!ring || ring.length < 3) return null;
  const mid: PtT = [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
  if (covers(rings, mid)) return mid;
  for (let i = 0; i < ring.length; i++) {
    for (let j = i + 2; j < ring.length; j++) {
      const m: PtT = [(ring[i][0] + ring[j][0]) / 2, (ring[i][1] + ring[j][1]) / 2];
      if (covers(rings, m)) return m;
    }
  }
  return null;
}

/** Where a place is, as one point: its pin, or somewhere inside its outline, or the middle of its line. */
function pinOf(s: Spot): PtT | null {
  if (s.lat !== null && s.lon !== null) return [s.lon, s.lat];
  if (s.rings.length) return interior(s.rings);
  if (s.line?.length) return s.line[Math.floor((s.line.length - 1) / 2)];
  return null;
}

export function pointAlong(path: PtT[], fraction: number): PtT {
  const lengths = path.slice(1).map((p, n) => metres(path[n], p, 1));
  let want = Math.max(0, Math.min(1, fraction)) * lengths.reduce((a, b) => a + b, 0);
  for (let n = 0; n < lengths.length; n++) {
    if (lengths[n] > 0 && want <= lengths[n]) {
      const t = want / lengths[n];
      return [path[n][0] + (path[n + 1][0] - path[n][0]) * t, path[n][1] + (path[n + 1][1] - path[n][1]) * t];
    }
    want -= lengths[n];
  }
  return path[path.length - 1];
}

export function standsAt(campaign: CampaignT | null): string | null {
  if (!campaign?.position) return campaign?.location ?? null;
  const [lon, lat] = campaign.position;
  return `${lat.toFixed(6)},${lon.toFixed(6)}`;
}

type Where = { world: string; at: PtT; spot: Spot | null; said: string };

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
    return { world, at: [lon, lat], spot: null, said: `${lat.toFixed(5)}, ${lon.toFixed(5)}` };
  }
  const id = text.toLowerCase();
  const world = worldOf(id);
  if (!world) return { error: `${id} is not a place on any world` };
  const spot = placesOn(world).find((s) => s.id === id);
  if (!spot) return { error: `${id} is not a place on the ground` };
  const at = pinOf(spot);
  if (!at) return { error: `${spot.name} has no position and no shape — the map cannot say where it is` };
  return { world, at, spot, said: spot.name };
}

function chainOf(id: string | null): string[] {
  if (!id) return [];
  return db
    .rows(
      `WITH RECURSIVE up(id, depth) AS (
         SELECT (SELECT parent FROM place WHERE id = ?), 0
         UNION
         SELECT p.parent, up.depth + 1 FROM place p JOIN up ON p.id = up.id
          WHERE up.depth < 32 AND p.parent IS NOT NULL
       )
       SELECT e.name FROM up JOIN entity e ON e.id = up.id ORDER BY up.depth`,
      [id]
    )
    .map((r) => String(r.name));
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
  const radius = radiusOf(where.world);
  const flat = page(where.at, radius);
  const me = flat.to(where.at);
  const all = placesOn(where.world);

  const standing = all
    .filter((s) => s.id !== where.spot?.id && s.rings.length && covers(s.rings, where.at))
    .sort((a, b) => area(a.rings) - area(b.rings))
    .map((s) => ({ id: s.id, name: s.name, type: s.type }));
  const inside = new Set(standing.map((s) => s.id));

  const near = [];
  for (const s of all) {
    if (s.id === where.spot?.id || inside.has(s.id)) continue;
    let reach: { d: number; q: PtT } | null = null;
    let runs: string | null = null;
    if (s.line?.length) {
      const run = s.line.map(flat.to);
      const hit = nearest(run, me);
      reach = { d: hit.d, q: flat.from(hit.q) };
      const a = flat.from(run[hit.seg]);
      const b = flat.from(run[Math.min(run.length - 1, hit.seg + 1)]);
      const heading = bearing(a, b);
      runs = `${point16(heading)}–${point16((heading + 180) % 360)}`;
    } else if (s.rings.length) {
      let best: { d: number; q: PtT } | null = null;
      for (const ring of s.rings) {
        const hit = nearest(ring.map(flat.to), me);
        if (!best || hit.d < best.d) best = { d: hit.d, q: flat.from(hit.q) };
      }
      reach = best;
    } else {
      const pin = pinOf(s);
      if (pin) reach = { d: gap(flat.to(pin), me), q: pin };
    }
    if (!reach || reach.d > within) continue;
    near.push({
      id: s.id, name: s.name, type: s.type,
      metres: Math.round(reach.d),
      bearing: reach.d < 1 ? null : point16(bearing(where.at, reach.q)),
      ...(runs ? { runs } : {}),
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
      const byId = new Map(all.map((s) => [s.id, s]));
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
    within: chainOf(where.spot?.id ?? null),
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
  const all = placesOn(a.world);
  const middle: PtT = [(a.at[0] + b.at[0]) / 2, (a.at[1] + b.at[1]) / 2];
  const flat = page(middle, radius);

  const nodes: PtT[] = [];
  const edges: Edge[][] = [];
  const node = (p: PtT) => {
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
  const cuts = new Map<string, Array<{ seg: number; t: number; p: PtT; n?: number }>>();
  for (const r of roads) cuts.set(r.id, r.line!.map((p, i) => ({ seg: i, t: 0, p })));
  const cut = (road: Spot, seg: number, t: number, p: PtT) => {
    const at = { seg, t, p, n: node(p) };
    cuts.get(road.id)!.push(at);
    return at.n!;
  };

  for (const r of roads) for (const p of cuts.get(r.id)!) p.n = node(p.p);

  for (let i = 0; i < roads.length; i++) {
    for (let j = 0; j < roads.length; j++) {
      if (i === j) continue;
      const run = roads[j].line!.map(flat.to);
      for (const own of cuts.get(roads[i].id)!.filter((c) => c.t === 0)) {
        const hit = nearest(run, flat.to(own.p));
        if (hit.d > JOIN) continue;
        const n = cut(roads[j], hit.seg, hit.t, flat.from(hit.q));
        link(own.n!, n, "join", "");
      }
    }
  }

  const start = node(a.at);
  const end = node(b.at);
  for (const [n, p] of [[start, a.at], [end, b.at]] as Array<[number, PtT]>) {
    for (const r of roads) {
      const hit = nearest(r.line!.map(flat.to), flat.to(p));
      const onto = cut(r, hit.seg, hit.t, flat.from(hit.q));
      link(n, onto, "off", "", ACROSS_COUNTRY);
    }
  }
  link(start, end, "off", "", ACROSS_COUNTRY);

  for (const r of roads) {
    const along = cuts.get(r.id)!.sort((x, y) => x.seg - y.seg || x.t - y.t);
    for (let k = 1; k < along.length; k++) link(along[k - 1].n!, along[k].n!, "road", r.name);
  }

  const pinned = new Map(all.map((s) => [s.id, s]));
  for (const w of db.rows("SELECT src, dst FROM way")) {
    const from = pinned.get(String(w.src));
    const to = pinned.get(String(w.dst));
    const p = from && pinOf(from);
    const q = to && pinOf(to);
    if (!p || !q) continue;
    const i = node(p);
    const j = node(q);
    edges[i].push({ to: j, m: 0, cost: 0, by: "door", name: to!.name });
    link(i, nearestNode(p), "join", "");
    link(j, nearestNode(q), "join", "");
  }
  function nearestNode(p: PtT) {
    let best = start;
    for (let n = 0; n < nodes.length - 2; n++) if (metres(nodes[n], p, radius) < metres(nodes[best], p, radius)) best = n;
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

  const legs: Array<{ by: string; name: string; metres: number; from: PtT; to: PtT }> = [];
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
  const path: PtT[] = [nodes[start], ...steps.map((s) => nodes[s.to])]
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
