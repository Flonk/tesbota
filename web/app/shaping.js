/**
 * Turning what a finger did into something the record can hold.
 *
 * A hand drawing a boundary makes hundreds of points and none of them are
 * measurements. Keeping all of them would say the coast was surveyed to the
 * centimetre, which is a lie the map would then repeat forever — so a freehand
 * run is thinned to the corners that actually carry its shape, and everything
 * between them is dropped.
 */

/** How far a point may sit off the line between its neighbours before it matters. */
export const LOOSE = 0.45;

const far = (p, a, b) => {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const span = dx * dx + dy * dy;
  if (!span) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / span));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

/**
 * Ramer–Douglas–Peucker: keep the point that strays furthest from the line, then
 * ask the same of each half. What survives is the shape; what goes is the hand.
 */
export function thin(points, room) {
  if (points.length < 3) return [...points];
  let worst = 0;
  let at = 0;
  for (let n = 1; n < points.length - 1; n++) {
    const off = far(points[n], points[0], points[points.length - 1]);
    if (off > worst) {
      worst = off;
      at = n;
    }
  }
  if (worst <= room) return [points[0], points[points.length - 1]];
  return [
    ...thin(points.slice(0, at + 1), room).slice(0, -1),
    ...thin(points.slice(at), room),
  ];
}

/** Drop points a hand put down on top of each other. */
const settled = (points, close) =>
  points.filter((p, n) => n === 0 || Math.hypot(p[0] - points[n - 1][0], p[1] - points[n - 1][1]) > close);

/**
 * What a freehand run becomes: thinned to its corners, and closed into a ring if
 * the hand came back near where it started.
 */
export function straighten(points, room = LOOSE, shut = null) {
  const near = settled(points, room / 3);
  if (near.length < 2) return null;
  const ends = Math.hypot(
    near[near.length - 1][0] - near[0][0],
    near[near.length - 1][1] - near[0][1]
  );
  const span = Math.max(
    ...near.map((p) => Math.hypot(p[0] - near[0][0], p[1] - near[0][1]))
  );
  const closing = shut === null ? ends < Math.max(span * 0.28, room * 4) : shut;
  const kept = thin(near, room);
  if (!closing) return { shut: false, points: kept };
  const ring = kept.length >= 4 ? kept.slice(0, -1) : kept;
  if (ring.length < 3) return null;
  return { shut: true, points: [...ring, ring[0]] };
}

/**
 * The runs of a shape, in degrees, however it is written, and which polygon each
 * ring belongs to — so that a hole is written back as a hole and not as an island.
 */
export function runsOf(extent) {
  let drawn;
  try {
    drawn = typeof extent === "string" ? JSON.parse(extent) : extent;
  } catch {
    return null;
  }
  const c = drawn?.coordinates;
  if (!Array.isArray(c)) return null;
  const polys =
    drawn.type === "LineString" ? [[c]]
    : drawn.type === "MultiLineString" ? c.map((line) => [line])
    : drawn.type === "Polygon" ? [c]
    : drawn.type === "MultiPolygon" ? c
    : null;
  if (!polys) return null;
  const runs = [];
  const groups = [];
  polys.forEach((rings, g) =>
    (rings || []).forEach((run) => {
      if (!Array.isArray(run) || !run.length) return;
      runs.push(run.map(([x, y]) => [x, y]));
      groups.push(g);
    })
  );
  if (!runs.length) return null;
  const shut = drawn.type === "Polygon" || drawn.type === "MultiPolygon";
  return { shut, runs, groups };
}

/** And back again, in the shape the record keeps. */
export function extentOf({ shut, runs, groups }) {
  if (!shut) {
    const run = runs.find((r) => r.length >= 2);
    return run ? { type: "LineString", coordinates: run } : null;
  }
  const polys = new Map();
  runs.forEach((run, n) => {
    const ring = closeRing(run);
    if (ring.length < 4) return;
    const g = groups?.[n] ?? n;
    if (!polys.has(g)) polys.set(g, []);
    polys.get(g).push(ring);
  });
  const all = [...polys.values()];
  if (!all.length) return null;
  if (all.length === 1) return { type: "Polygon", coordinates: all[0] };
  return { type: "MultiPolygon", coordinates: all };
}

function closeRing(run) {
  const open = run.length > 1 &&
    run[0][0] === run[run.length - 1][0] && run[0][1] === run[run.length - 1][1]
      ? run.slice(0, -1)
      : run;
  return open.length < 3 ? open : [...open, open[0]];
}

/** The same run with one corner moved, added or taken away. */
export const moved = (run, at, point) => run.map((p, n) => (n === at ? point : p));
export const added = (run, at, point) => [...run.slice(0, at), point, ...run.slice(at)];
export const dropped = (run, at) => run.filter((_, n) => n !== at);

const same = (a, b) => a[0] === b[0] && a[1] === b[1];

/** The ring without its repeated closing point. */
export const opened = (run) =>
  run.length > 1 && same(run[0], run[run.length - 1]) ? run.slice(0, -1) : run;

/** The vertices from one index round to another, going forward, both ends kept. */
const span = (run, from, to) => {
  const out = [];
  for (let n = from, guard = 0; guard <= run.length; n = (n + 1) % run.length, guard++) {
    out.push(run[n]);
    if (n === to) break;
  }
  return out;
};

const area = (run) => {
  let sum = 0;
  for (let i = 0, j = run.length - 1; i < run.length; j = i++) {
    sum += run[j][0] * run[i][1] - run[i][0] * run[j][1];
  }
  return Math.abs(sum / 2);
};

/** The point on an outline nearest to p: which edge, how far along it, how far off. */
export function onto(run, p, shut) {
  let best = null;
  const edges = shut ? run.length : run.length - 1;
  for (let i = 0; i < edges; i++) {
    const a = run[i];
    const b = run[(i + 1) % run.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
    const q = [a[0] + t * dx, a[1] + t * dy];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (!best || d < best.d) best = { i, t, q, d };
  }
  return best;
}

/** Put both ends of a stroke into the outline where they land on it. */
function pierce(run, a, b) {
  const marked = run.map((p) => ({ p }));
  const cuts = [{ ...a, tag: "a" }, { ...b, tag: "b" }].sort((x, y) => y.i - x.i || y.t - x.t);
  for (const cut of cuts) marked.splice(cut.i + 1, 0, { p: cut.q, tag: cut.tag });
  return {
    points: marked.map((m) => m.p),
    ia: marked.findIndex((m) => m.tag === "a"),
    ib: marked.findIndex((m) => m.tag === "b"),
  };
}

/**
 * A stroke over a ring that already exists, which alters it rather than replacing
 * it. Both ends have to land on the outline — within `reach` of it — and where
 * they land becomes a corner, so a notch in the middle of a long edge stays in the
 * middle of it. The stroke stands in for one of the two ways round between them,
 * leaving two shapes it could have meant: the body of the thing with the stroke's
 * line for one side, or the piece the stroke cut off.
 *
 * The body is the one meant, always, and that one choice gives both behaviours
 * without being told which is happening: a stroke swung outside adds its bulge to
 * the body and the shape grows; a stroke cut across the inside leaves the body
 * short of whatever it lopped off, and the shape shrinks.
 */
export function rework(ring, stroke, room = LOOSE, reach = Infinity) {
  if (ring.length < 3 || stroke.length < 2) return null;
  const a = onto(ring, stroke[0], true);
  const b = onto(ring, stroke[stroke.length - 1], true);
  if (a.d > reach || b.d > reach) return null;
  if (Math.hypot(a.q[0] - b.q[0], a.q[1] - b.q[1]) <= room) return null;
  const { points, ia, ib } = pierce(ring, a, b);
  const line = thin([a.q, ...stroke.slice(1, -1), b.q], room / 2);
  const ways = [
    [...line, ...span(points, ib, ia).slice(1, -1)],
    [...line, ...[...span(points, ia, ib)].reverse().slice(1, -1)],
  ].filter((way) => way.length >= 3);
  if (!ways.length) return null;
  return ways.reduce((big, way) => (area(way) > area(big) ? way : big));
}

/**
 * The same for a run that does not close — a road, a river. A stroke that lands on
 * it at both ends replaces the stretch between; one that starts or finishes at
 * either end of it carries it on.
 */
export function rerun(run, stroke, room = LOOSE, reach = Infinity) {
  if (run.length < 2 || stroke.length < 2) return null;
  const first = stroke[0];
  const last = stroke[stroke.length - 1];
  const a = onto(run, first, false);
  const b = onto(run, last, false);
  const gap = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  if (a.d <= reach && b.d <= reach && gap(a.q, b.q) > room) {
    const { points, ia, ib } = pierce(run, a, b);
    const line = thin([a.q, ...stroke.slice(1, -1), b.q], room / 2);
    return ia < ib
      ? [...points.slice(0, ia), ...line, ...points.slice(ib + 1)]
      : [...points.slice(0, ib), ...[...line].reverse(), ...points.slice(ia + 1)];
  }
  const head = run[0];
  const tail = run[run.length - 1];
  const tail_on = (p) => gap(p, tail) <= reach;
  const head_on = (p) => gap(p, head) <= reach;
  const line = (points) => thin(points, room / 2);
  if (tail_on(first)) return [...run, ...line([tail, ...stroke.slice(1)]).slice(1)];
  if (head_on(first)) return [...line([head, ...stroke.slice(1)]).slice(1).reverse(), ...run];
  if (tail_on(last)) return [...run, ...line([tail, ...[...stroke].reverse().slice(1)]).slice(1)];
  if (head_on(last)) return [...line([...stroke.slice(0, -1), head]).slice(0, -1), ...run];
  return null;
}

/** Whether a shape's rings cover a point, counting crossings over all of them. */
export function covers(runs, [x, y]) {
  let inside = false;
  for (const run of runs) {
    for (let i = 0, j = run.length - 1; i < run.length; j = i++) {
      const [xi, yi] = run[i];
      const [xj, yj] = run[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** The same shape, every point of it moved by the same amount. */
export const carried = (runs, by) =>
  runs.map((run) => run.map(([x, y]) => [x + by.lon, y + by.lat]));
