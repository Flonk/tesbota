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

/** The runs of a shape, in degrees, however it is written. */
export function runsOf(extent) {
  let drawn;
  try {
    drawn = typeof extent === "string" ? JSON.parse(extent) : extent;
  } catch {
    return null;
  }
  const runs = [];
  const walk = (node) => {
    if (!Array.isArray(node)) return;
    if (node.length && Array.isArray(node[0]) && typeof node[0][0] === "number") runs.push(node);
    else node.forEach(walk);
  };
  walk(drawn?.coordinates);
  if (!runs.length) return null;
  return { shut: drawn.type !== "LineString", runs: runs.map((r) => r.map(([x, y]) => [x, y])) };
}

/** And back again, in the shape the record keeps. */
export function extentOf({ shut, runs }) {
  const clean = runs
    .map((run) => (shut ? closeRing(run) : run))
    .filter((run) => run.length >= (shut ? 4 : 2));
  if (!clean.length) return null;
  if (!shut) return { type: "LineString", coordinates: clean[0] };
  if (clean.length === 1) return { type: "Polygon", coordinates: clean };
  return { type: "MultiPolygon", coordinates: clean.map((run) => [run]) };
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

const nearest = (run, p) => {
  let at = 0;
  let best = Infinity;
  run.forEach((q, n) => {
    const gap = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (gap < best) {
      best = gap;
      at = n;
    }
  });
  return at;
};

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

/**
 * A stroke over a shape that already exists, which alters it rather than
 * replacing it. Its two ends find the corners they are nearest, and the stroke
 * stands in for one of the two ways round between them — leaving two shapes it
 * could have meant: the body of the thing with the stroke's line for one side, or
 * the piece the stroke cut off.
 *
 * The body is the one meant, always, and that one choice gives both behaviours
 * without being told which is happening: a stroke swung outside adds its bulge to
 * the body and the shape grows; a stroke cut across the inside leaves the body
 * short of whatever it lopped off, and the shape shrinks. No polygon algebra, and
 * nothing to get the wrong way round.
 */
export function reshape(run, stroke, room = LOOSE) {
  const ring = opened(run);
  if (ring.length < 3 || stroke.length < 2) return null;

  const at = nearest(ring, stroke[0]);
  let to = nearest(ring, stroke[stroke.length - 1]);
  // Both ends nearest the same corner is a stroke worked around one point rather
  // than between two. It still means something — take the next corner along, on
  // the side the stroke actually ended.
  if (at === to) {
    const last = stroke[stroke.length - 1];
    const before = ring[(at - 1 + ring.length) % ring.length];
    const after = ring[(at + 1) % ring.length];
    const gap = (p) => Math.hypot(p[0] - last[0], p[1] - last[1]);
    to = gap(after) <= gap(before) ? (at + 1) % ring.length : (at - 1 + ring.length) % ring.length;
  }
  if (at === to) return null;

  const ways = [
    [...stroke, ...span(ring, to, at)],
    [...stroke, ...[...span(ring, at, to)].reverse()],
  ]
    .map((way) => thin(way, room / 2))
    .filter((way) => way.length >= 3);
  if (!ways.length) return null;

  const took = ways.reduce((big, way) => (area(way) > area(big) ? way : big));
  return [...took, took[0]];
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
