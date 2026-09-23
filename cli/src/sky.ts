/**
 * The sky, solved.
 *
 * The world writes down what a body *is* — how heavy, how wide, how far out it
 * keeps, how far over it leans, how fast it turns. It does not write down how long
 * a year is, because a year is not a fact about a world, it is a consequence of
 * one. Same posture the map itself takes: what was measured is recorded and the
 * coordinates are solved, so there is never a stored number that can disagree with
 * the numbers it came from.
 *
 * So: no period column, no day-length column, no days-per-year column. A body that
 * moves further out has a longer year the next time anybody asks.
 *
 * The one convention that is not physics: the world's clock reads the prime
 * meridian's solar time, and a day is cut into 24 hours of 60 minutes whatever the
 * body's day actually lasts. Hours are cultural, the day is physical.
 */

import * as db from "./db.ts";
import { DAYS_PER_YEAR, WORLD_SKY } from "./config.ts";

/** m³ kg⁻¹ s⁻². */
export const G = 6.6743e-11;

export const MINUTES_PER_DAY = 24 * 60;

/** How far below the horizon the sun's centre is when its upper limb touches it. */
export const REFRACTION = -0.833;

export type Body = {
  id: string;
  name: string;
  /** what sort of place it is — `celestial-body`, `celestial-system` */
  type: string | null;
  /** the system it sits in, or null for the outermost */
  parent: string | null;
  /** what it goes round: always the middle of the system it sits in */
  around: string | null;
  /** semi-major axis, metres */
  semiMajor: number | null;
  eccentricity: number;
  /** mean longitude when the era began, degrees */
  longitude: number;
  /** longitude of periapsis, degrees */
  periapsis: number;
  /** kilograms — for a system, what it weighs over and above what is in it */
  mass: number | null;
  /** equatorial radius, metres */
  radius: number | null;
  /** (equatorial − polar) / equatorial */
  oblateness: number;
  /** axial tilt, degrees — the one that makes seasons */
  tilt: number;
  /** sidereal rotation, seconds */
  rotation: number | null;
  /** which meridian faced its star when the era began, degrees */
  meridian: number;
};

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Heavy enough to burn hydrogen, and so to be what lights the worlds around it. */
export const STAR_MASS = 1.5e29;

export const wrap360 = (deg: number) => ((deg % 360) + 360) % 360;
export const wrap180 = (deg: number) => wrap360(deg + 180) - 180;

const CELESTIAL = ["celestial-body", "celestial-system"];

export function bodies(): Record<string, Body> {
  const out: Record<string, Body> = {};
  const rows = db.rows(
    `SELECT e.id, e.name, p.type, p.parent,
            o.semi_major, o.eccentricity, o.longitude, o.periapsis, o.mass, o.radius,
            o.oblateness, o.tilt, o.rotation, o.meridian
       FROM entity e
       LEFT JOIN place p ON p.id = e.id
       LEFT JOIN orbit o ON o.id = e.id
      WHERE p.type IN (?, ?) OR o.id IS NOT NULL
      ORDER BY e.id`,
    CELESTIAL
  );
  const ids = new Set(rows.map((r) => String(r.id)));
  for (const r of rows) {
    const parent = r.parent && ids.has(String(r.parent)) ? String(r.parent) : null;
    out[String(r.id)] = {
      id: String(r.id),
      name: String(r.name),
      type: r.type ?? null,
      parent,
      around: parent,
      semiMajor: r.semi_major ?? null,
      eccentricity: Number(r.eccentricity ?? 0),
      longitude: Number(r.longitude ?? 0),
      periapsis: Number(r.periapsis ?? 0),
      mass: r.mass ?? null,
      radius: r.radius ?? null,
      oblateness: Number(r.oblateness ?? 0),
      tilt: Number(r.tilt ?? 0),
      rotation: r.rotation ?? null,
      meridian: Number(r.meridian ?? 0),
    };
  }
  return out;
}

export const body = (id: string): Body | null => bodies()[id] ?? null;

const inside = (it: Body, known: Record<string, Body>) =>
  Object.values(known).filter((other) => other.parent === it.id);

/**
 * What a thing weighs, all in. A body is its own mass; a system is everything in
 * it, and whatever it was written down as weighing besides — the gas, the dust,
 * the dark that nobody can see and everything can feel.
 */
export function weight(it: Body, known: Record<string, Body> = bodies(), seen = new Set<string>()): number {
  if (seen.has(it.id)) return 0;
  seen.add(it.id);
  const own = Number(it.mass ?? 0);
  return own + inside(it, known).reduce((sum, child) => sum + weight(child, known, seen), 0);
}

/**
 * How long it takes to go round the middle of its system once, in seconds.
 * Kepler's third, with everything the system holds pulling.
 */
export function period(it: Body, known: Record<string, Body> = bodies()): number | null {
  if (!it.semiMajor || !it.parent) return null;
  const held = known[it.parent];
  const mass = held ? weight(held, known) : 0;
  if (!mass) return null;
  return 2 * Math.PI * Math.sqrt(it.semiMajor ** 3 / (G * mass));
}

const chain = (it: Body, known: Record<string, Body>) => {
  const up: Body[] = [];
  for (let at: Body | undefined = it; at && up.length < 64; at = at.parent ? known[at.parent] : undefined) {
    up.push(at);
  }
  return up;
};

const shines = (it: Body) => it.type !== "celestial-system" && Number(it.mass ?? 0) >= STAR_MASS;

/**
 * What lights a body: the nearest star, looking outward one system at a time and
 * never inside the body's own branch. A world takes its sun from the system its own
 * system sits in; a moon from the same one, a step further out.
 */
const kept_star = new WeakMap<Record<string, Body>, Map<string, Body | null>>();

export function star(it: Body, known: Record<string, Body> = bodies()): Body | null {
  let seen = kept_star.get(known);
  if (!seen) kept_star.set(known, (seen = new Map()));
  if (!seen.has(it.id)) seen.set(it.id, starOf(it, known));
  return seen.get(it.id)!;
}

function starOf(it: Body, known: Record<string, Body>): Body | null {
  const up = chain(it, known);
  for (let n = 1; n < up.length; n++) {
    const branch = up[n - 1];
    const lit: Body[] = [];
    const look = (at: Body) => {
      if (at.id === branch.id) return;
      if (shines(at)) lit.push(at);
      for (const child of inside(at, known)) look(child);
    };
    for (const child of inside(up[n], known)) look(child);
    if (lit.length) return lit.reduce((a, b) => (Number(b.mass) > Number(a.mass) ? b : a));
  }
  return null;
}

/** Of everything a body sits inside, the one that goes round its star. */
function circler(it: Body, known: Record<string, Body>): Body | null {
  const sun = star(it, known);
  if (!sun) return null;
  return chain(it, known).find((at) => at.parent === sun.parent) ?? null;
}

/** How long a body's year is: however long whatever carries it takes to go round its star. */
export function year(it: Body, known: Record<string, Body> = bodies()): number | null {
  const going = circler(it, known);
  return going ? period(going, known) : null;
}

/**
 * The day you would actually live through, in seconds. A prograde spin comes back
 * round to face the star one turn later than it comes back round to face the
 * others — exactly one turn's worth over a whole year.
 */
export function solarDay(it: Body, known: Record<string, Body> = bodies()): number | null {
  const sidereal = it.rotation;
  const long = year(it, known);
  if (!sidereal) return null;
  if (!long || long === sidereal) return sidereal;
  return (sidereal * long) / (long - sidereal);
}

/** How many of its own days a body's year runs to. */
export function daysPerYear(it: Body, known: Record<string, Body> = bodies()): number | null {
  const long = year(it, known);
  const day = solarDay(it, known);
  return long && day ? long / day : null;
}

/**
 * Where in its orbit it is, as an angle from the equinox. Kepler's equation has no
 * closed form, so it is solved — Newton converges in a handful of passes at any
 * eccentricity a world is likely to have.
 */
export function trueAnomaly(meanDeg: number, e: number): number {
  const mean = wrap360(meanDeg) * RAD;
  let anomaly = mean;
  for (let n = 0; n < 24; n++) {
    const step = (anomaly - e * Math.sin(anomaly) - mean) / (1 - e * Math.cos(anomaly));
    anomaly -= step;
    if (Math.abs(step) < 1e-12) break;
  }
  return (
    2 *
    Math.atan2(
      Math.sqrt(1 + e) * Math.sin(anomaly / 2),
      Math.sqrt(1 - e) * Math.cos(anomaly / 2)
    ) *
    DEG
  );
}

export type When = { year?: number; day?: number; minute?: number; [k: string]: unknown };

/**
 * Seconds since the era began. Dates are kept on the home world: the calendar
 * divides its day into 1440 minutes whatever the day lasts, so a minute is a
 * fraction of that world's day and not a fixed sixty seconds.
 */
export function elapsed(when: When, known: Record<string, Body> = bodies()): number | null {
  const it = home(known);
  if (!it) return null;
  const day = solarDay(it, known);
  const perYear = daysPerYear(it, known);
  if (!day || !perYear) return null;
  const days =
    Number(when.year ?? 0) * perYear +
    (Number(when.day ?? 1) - 1) +
    Number(when.minute ?? 0) / MINUTES_PER_DAY;
  return days * day;
}

/**
 * Where on its orbit a body stands when it is that far round, in metres from the
 * middle of its system. The middle sits at a focus and not at the centre of the
 * ellipse, which is the whole difference an eccentricity makes.
 */
export function atLongitude(it: Body, deg: number): { x: number; y: number; r: number } | null {
  if (!it.semiMajor) return null;
  const e = it.eccentricity;
  const from = (deg - it.periapsis) * RAD;
  const r = (it.semiMajor * (1 - e * e)) / (1 + e * Math.cos(from));
  return { x: r * Math.cos(deg * RAD), y: r * Math.sin(deg * RAD), r };
}

/**
 * Where it is in its own system, now. Something with an orbit and nothing to pull
 * it round stays where it was put; something with no orbit sits at the middle.
 */
export function at(it: Body, when: When, known: Record<string, Body> = bodies()) {
  if (!it.semiMajor) return null;
  const long = period(it, known);
  const since = elapsed(when, known);
  const mean = long && since !== null ? it.longitude + 360 * (since / long) : it.longitude;
  const angle = long ? wrap360(trueAnomaly(mean - it.periapsis, it.eccentricity) + it.periapsis) : wrap360(it.longitude);
  const spot = atLongitude(it, angle);
  return spot && { ...spot, angle };
}

/**
 * Where it is inside one of the systems it sits in, adding up every system between.
 * Only ever as far out as it has to go: a galaxy's worth of metres added to a
 * world's would leave nothing of the world's in the sum.
 */
function placed(it: Body, when: When, known: Record<string, Body>, within: string | null = null) {
  let x = 0;
  let y = 0;
  for (const step of chain(it, known)) {
    if (step.id === within) break;
    const spot = at(step, when, known);
    if (spot) {
      x += spot.x;
      y += spot.y;
    }
  }
  return { x, y };
}

/** How far round its star a body has got, as an angle from the equinox. */
export function seasonAngle(
  it: Body, when: When, known: Record<string, Body> = bodies()
): number | null {
  const sun = star(it, known);
  if (!sun || elapsed(when, known) === null) return null;
  const mine = new Set(chain(it, known).map((step) => step.id));
  const shared = chain(sun, known).find((step) => mine.has(step.id))?.id ?? null;
  const from = placed(sun, when, known, shared);
  const to = placed(it, when, known, shared);
  if (from.x === to.x && from.y === to.y) return null;
  return wrap360(Math.atan2(to.y - from.y, to.x - from.x) * DEG);
}

/**
 * The four days the tilt turns on: the two the star stands furthest from the
 * equator, and the two it crosses it. They are found by walking the year rather
 * than by formula, because the year is however many days it is.
 */
export function seasons(it: Body, when: When, known: Record<string, Body> = bodies()) {
  const keeper = home(known);
  const day = keeper ? solarDay(keeper, known) : null;
  const long = year(it, known);
  const count = day && long ? Math.round(long / day) : 0;
  if (!count || !it.tilt) return [];
  const lat: number[] = [];
  for (let n = 1; n <= count; n++) {
    const spot = subsolar(it, { ...when, day: n, minute: MINUTES_PER_DAY / 2 }, known);
    lat.push(spot ? spot.lat : 0);
  }
  const low = Math.min(...lat);
  const high = Math.max(...lat);
  const last = (want: number) => {
    let at = 0;
    lat.forEach((l, n) => {
      if (Math.abs(l - want) < 1e-9) at = n;
    });
    return at + 1;
  };
  const found: Array<{ name: string; says: string; day: number; lat: number }> = [
    { name: "winter-solstice", says: "winter solstice", day: last(low), lat: low },
    { name: "summer-solstice", says: "summer solstice", day: last(high), lat: high },
  ];
  for (let n = 0; n < count; n++) {
    const here = lat[n];
    const next = lat[(n + 1) % count];
    if (here <= 0 && next > 0) {
      found.push({ name: "vernal-equinox", says: "vernal equinox", day: n + 2, lat: next });
    }
    if (here >= 0 && next < 0) {
      found.push({ name: "autumnal-equinox", says: "autumnal equinox", day: n + 2, lat: next });
    }
  }
  return found
    .map((mark) => ({
      ...mark,
      angle: seasonAngle(it, { ...when, day: mark.day, minute: MINUTES_PER_DAY / 2 }, known),
    }))
    .sort((a, b) => a.day - b.day);
}

/**
 * The point the star stands straight over. Its latitude is the season; its
 * longitude is the hour — on the home world the clock is the prime meridian's
 * solar time, and anywhere else it is however far round that world has turned.
 */
export function subsolar(
  it: Body, when: When, known: Record<string, Body> = bodies()
): { lat: number; lon: number } | null {
  const angle = seasonAngle(it, when, known);
  if (angle === null) return null;
  const lat = Math.asin(Math.sin(it.tilt * RAD) * Math.sin(angle * RAD)) * DEG;
  let turned: number;
  if (home(known)?.id === it.id) {
    turned = Number(when.minute ?? 0) / MINUTES_PER_DAY;
  } else {
    const day = solarDay(it, known);
    const since = elapsed(when, known);
    turned = day && since !== null ? since / day - Math.floor(since / day) : 0;
  }
  const lon = wrap180(180 - 360 * turned + it.meridian);
  return { lat, lon };
}

/** How high the star stands over a place, in degrees. Negative is below. */
export function altitude(
  it: Body, when: When, lat: number, lon: number, known: Record<string, Body> = bodies()
): number | null {
  const at = subsolar(it, when, known);
  if (!at) return null;
  const hour = wrap180(lon - at.lon) * RAD;
  const sin =
    Math.sin(lat * RAD) * Math.sin(at.lat * RAD) +
    Math.cos(lat * RAD) * Math.cos(at.lat * RAD) * Math.cos(hour);
  return Math.asin(Math.max(-1, Math.min(1, sin))) * DEG;
}

export function sunUp(
  it: Body, when: When, lat: number, lon: number, known: Record<string, Body> = bodies()
): boolean | null {
  const high = altitude(it, when, lat, lon, known);
  return high === null ? null : high > REFRACTION;
}

/**
 * How much of the day the star is above the horizon, in minutes. A latitude the
 * season has tipped fully into the light or fully out of it gets the whole day or
 * none of it, which is what a pole is.
 */
export function dayLength(
  it: Body, when: When, lat: number, known: Record<string, Body> = bodies()
): number | null {
  const at = subsolar(it, when, known);
  if (!at) return null;
  const top = Math.sin(REFRACTION * RAD) - Math.sin(lat * RAD) * Math.sin(at.lat * RAD);
  const bottom = Math.cos(lat * RAD) * Math.cos(at.lat * RAD);
  if (!bottom) return top < 0 ? MINUTES_PER_DAY : 0;
  const cos = top / bottom;
  if (cos <= -1) return MINUTES_PER_DAY;
  if (cos >= 1) return 0;
  return (2 * Math.acos(cos) * DEG * MINUTES_PER_DAY) / 360;
}

/**
 * Where the day/night line crosses a meridian. This is what a flat map draws, and
 * it is the only thing in here the map will need that the clock does not.
 */
export function terminator(
  it: Body, when: When, lon: number, known: Record<string, Body> = bodies()
): number | null {
  const at = subsolar(it, when, known);
  if (!at) return null;
  const tan = Math.tan(at.lat * RAD);
  if (!tan) return 0;
  return Math.atan(-Math.cos(wrap180(lon - at.lon) * RAD) / tan) * DEG;
}

const kept_home = new WeakMap<Record<string, Body>, Body | null>();

/**
 * The body the calendar is kept on: a world that turns and has a star to turn
 * under, and of those the one the most places stand on. A world with none falls
 * back on the constants, which is how a fresh profile keeps a calendar before
 * anybody has written the sky down.
 */
export function home(known: Record<string, Body> = bodies()): Body | null {
  if (kept_home.has(known)) return kept_home.get(known)!;
  const turning = Object.values(known).filter(
    (it) => it.type !== "celestial-system" && it.rotation && star(it, known) && year(it, known)
  );
  const held = (it: Body) =>
    Number(
      db.value(
        `WITH RECURSIVE under(id) AS (
           SELECT ?
           UNION
           SELECT p.id FROM place p JOIN under u ON p.parent = u.id
         )
         SELECT count(*) FROM under`,
        [it.id],
        0
      ) ?? 0
    );
  const found =
    turning
      .map((it) => ({ it, held: held(it) }))
      .sort((a, b) => b.held - a.held || Number(b.it.mass ?? 0) - Number(a.it.mass ?? 0))[0]?.it ?? null;
  kept_home.set(known, found);
  return found;
}

let kept: { days: number } | null | undefined;

/** How long a year is, solved once and remembered for the life of the process. */
export function calendar(): { days: number; derived: boolean } {
  if (kept === undefined) {
    try {
      const known = bodies();
      const it = home(known);
      const days = it ? daysPerYear(it, known) : null;
      kept = days && days > 1 ? { days: Math.round(days) } : null;
    } catch {
      kept = null;
    }
  }
  return kept ? { days: kept.days, derived: true } : { days: DAYS_PER_YEAR, derived: false };
}

/** Forget the solved year, for a process that has just written the sky. */
export const reread = () => {
  kept = undefined;
};

/**
 * The outermost system: the one the home world sits in, however deep, or failing
 * that the first one that sits in nothing.
 */
export function system(known: Record<string, Body> = bodies()) {
  const start = home(known) ?? Object.values(known).find((it) => !it.parent) ?? null;
  if (!start) return null;
  const top = chain(start, known).at(-1)!;
  return { id: top.id, name: top.name };
}

/**
 * Everything a body sits inside, outermost first. A world is not simply in its
 * system: it is in its own reach, and that is in the system.
 */
export function above(id: string) {
  const chain = db.rows(
    `WITH RECURSIVE up(id, depth) AS (
       SELECT (SELECT parent FROM place WHERE id = ?), 0
       UNION
       SELECT p.parent, up.depth + 1 FROM place p JOIN up ON p.id = up.id
        WHERE up.depth < 32 AND p.parent IS NOT NULL
     )
     SELECT up.id, e.name FROM up JOIN entity e ON e.id = up.id ORDER BY up.depth DESC`,
    [id]
  );
  return chain.map((r) => ({ id: String(r.id), name: String(r.name) }));
}

/**
 * The whole sky as plain data, which is what the map draws: every body and every
 * system, each placed in the one it sits in.
 */
export function describe(when: When | null = null, been = new Set<string>()) {
  const known = bodies();
  const out: Record<string, unknown> = {};
  for (const id of Object.keys(known).sort()) {
    const it = known[id];
    const lit = star(it, known);
    const world = it.type !== "celestial-system";
    out[id] = {
      ...it,
      mass: it.type === "celestial-system" ? weight(it, known) || null : it.mass,
      inside: inside(it, known).map((child) => child.id),
      star: lit?.id ?? null,
      period: period(it, known),
      year: world ? year(it, known) : null,
      solar_day: world ? solarDay(it, known) : null,
      days_per_year: world ? daysPerYear(it, known) : null,
      moves: !!period(it, known),
      at: when ? at(it, when, known) : null,
      subsolar: when && world ? subsolar(it, when, known) : null,
      seasons: when && world ? seasons(it, when, known) : [],
      standing: when && world ? standing(it, when, known, been) : [],
      above: above(it.id),
    };
  }
  return {
    bodies: out, home: home(known)?.id ?? null, system: system(known),
    calendar: calendar(), when,
  };
}

/**
 * Put the starting sky down where it is missing, and never over the top of what
 * is already there — a body lore has moved stays moved. Only bodies that already
 * have an entity row are touched, so this never mints a world.
 */
export function seed(): string[] {
  const written: string[] = [];
  db.writing((con) => {
    for (const [id, given] of Object.entries(WORLD_SKY as Record<string, Record<string, number | string>>)) {
      const there = con.prepare("SELECT 1 FROM entity WHERE id = ? AND kind = 'places'").get(id);
      if (!there) continue;
      if (con.prepare("SELECT 1 FROM orbit WHERE id = ?").get(id)) continue;
      const columns = ["id", ...Object.keys(given)];
      con
        .prepare(
          `INSERT INTO orbit (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`
        )
        .run(id, ...Object.values(given));
      written.push(id);
    }
  });
  if (written.length) reread();
  return written;
}

export type Standing = {
  id: string;
  name: string;
  type: string | null;
  parent: string | null;
  lat: number | null;
  lon: number | null;
  extent: string | null;
  walked: boolean;
  altitude: number | null;
  day: boolean | null;
};

/**
 * Everywhere on a body that anybody has fixed a position for, however deep it
 * sits, and whether the star is above the horizon there right now.
 *
 * This is the whole point of writing a tilt down. Until something stands at a
 * latitude, a day/night line is a drawing; once something does, the world can be
 * asked whether it is dark where the adventurer is and answer without guessing.
 */
export function standing(
  it: Body, when: When, known: Record<string, Body> = bodies(), been = new Set<string>()
): Standing[] {
  const rows = db.rows(
    `WITH RECURSIVE under(id) AS (
       SELECT ?
       UNION
       SELECT p.id FROM place p JOIN under u ON p.parent = u.id
     )
     SELECT p.id, e.name, e.extent, p.type, p.parent, p.lat, p.lon
       FROM place p JOIN entity e ON e.id = p.id
      WHERE p.id IN (SELECT id FROM under)
        AND p.id <> ?
      ORDER BY lower(e.name)`,
    [it.id, it.id]
  );
  return rows.map((r) => {
    const lat = r.lat === null || r.lat === undefined ? null : Number(r.lat);
    const lon = r.lon === null || r.lon === undefined ? null : Number(r.lon);
    const high = lat !== null && lon !== null ? altitude(it, when, lat, lon, known) : null;
    return {
      id: String(r.id),
      name: String(r.name),
      type: r.type ?? null,
      parent: r.parent ?? null,
      lat,
      lon,
      extent: r.extent ?? null,
      walked: been.has(String(r.id)),
      altitude: high === null ? null : Number(high.toFixed(3)),
      day: high === null ? null : high > REFRACTION,
    };
  });
}
