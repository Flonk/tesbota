/** Points, rings and lines, in degrees and the way GeoJSON writes a point: `[lon, lat]`. */

import type { PtT } from "./schema.ts";

export type Shape = { rings: PtT[][]; line: PtT[] | null };

export const RAD = Math.PI / 180;
export const DEG = 180 / Math.PI;

const POINTS = [
  "north", "north-north-east", "north-east", "east-north-east",
  "east", "east-south-east", "south-east", "south-south-east",
  "south", "south-south-west", "south-west", "west-south-west",
  "west", "west-north-west", "north-west", "north-north-west",
];

export const point16 = (deg: number) => POINTS[Math.round(deg / 22.5) % 16];

export function runsIn(coordinates: unknown): PtT[][] {
  const runs: PtT[][] = [];
  const walk = (node: unknown) => {
    if (!Array.isArray(node)) return;
    if (node.length && Array.isArray(node[0]) && typeof node[0][0] === "number") runs.push(node);
    else node.forEach(walk);
  };
  walk(coordinates);
  return runs;
}

export function shapeOf(extent: string | null): Shape {
  let drawn: { type?: unknown; coordinates?: unknown } | null;
  try {
    drawn = JSON.parse(String(extent));
  } catch {
    return { rings: [], line: null };
  }
  if (drawn?.type === "LineString") return { rings: [], line: runsIn(drawn.coordinates)[0] ?? null };
  if (drawn?.type === "Polygon" || drawn?.type === "MultiPolygon") return { rings: runsIn(drawn.coordinates), line: null };
  return { rings: [], line: null };
}

/** Every coordinate in a shape, moved by the same amount. */
export function dragged(extent: string, by: { lon: number; lat: number }): string | null {
  let drawn: { coordinates?: unknown };
  try {
    drawn = JSON.parse(extent);
  } catch {
    return null;
  }
  const walk = (node: unknown): unknown => {
    if (!Array.isArray(node)) return node;
    if (node.length === 2 && typeof node[0] === "number" && typeof node[1] === "number") {
      return [node[0] + by.lon, node[1] + by.lat];
    }
    return node.map(walk);
  };
  drawn.coordinates = walk(drawn.coordinates);
  return JSON.stringify(drawn);
}

export function covers(rings: PtT[][], [x, y]: PtT) {
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

export function area(rings: PtT[][]) {
  let total = 0;
  for (const ring of rings) {
    let sum = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    total += Math.abs(sum / 2);
  }
  return total;
}

export function interior(rings: PtT[][]): PtT | null {
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
export function pinOf(s: { lat: number | null; lon: number | null } & Shape): PtT | null {
  if (s.lat !== null && s.lon !== null) return [s.lon, s.lat];
  if (s.rings.length) return interior(s.rings);
  const run = s.line ?? [];
  const m = run[Math.floor((run.length - 1) / 2)];
  return m && Number.isFinite(m[0]) && Number.isFinite(m[1]) ? m : null;
}

/** A flat page of metres around one point, good for the few kilometres a walk spans. */
export function page(origin: PtT, radius: number) {
  const k = (2 * Math.PI * radius) / 360;
  const c = Math.cos(origin[1] * RAD);
  return {
    to: ([lon, lat]: PtT): PtT => [(lon - origin[0]) * k * c, (lat - origin[1]) * k],
    from: ([x, y]: PtT): PtT => [origin[0] + x / (k * c), origin[1] + y / k],
  };
}

export type Page = ReturnType<typeof page>;

export const gap = (a: PtT, b: PtT) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Great-circle metres, so a long road is not measured on a flat page. */
export function metres(a: PtT, b: PtT, radius: number) {
  const dLat = (b[1] - a[1]) * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
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

export function bearing(a: PtT, b: PtT) {
  const y = Math.sin((b[0] - a[0]) * RAD) * Math.cos(b[1] * RAD);
  const x = Math.cos(a[1] * RAD) * Math.sin(b[1] * RAD) -
    Math.sin(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.cos((b[0] - a[0]) * RAD);
  return ((Math.atan2(y, x) / RAD) + 360) % 360;
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

export function closest(runs: PtT[][], p: PtT, flat: Page) {
  const at = flat.to(p);
  let best: { q: PtT; d: number; seg: number; t: number } | null = null;
  for (const run of runs) {
    const hit = nearest(run.map(flat.to), at);
    if (!best || hit.d < best.d) best = { ...hit, q: flat.from(hit.q) };
  }
  return best;
}
