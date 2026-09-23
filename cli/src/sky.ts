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
  /** what it goes round, or null for the thing everything else goes round */
  around: string | null;
  /** semi-major axis, metres */
  semiMajor: number | null;
  eccentricity: number;
  /** mean longitude when the era began, degrees */
  longitude: number;
  /** longitude of periapsis, degrees */
  periapsis: number;
  /** kilograms */
  mass: number | null;
  /** equatorial radius, metres */
  radius: number | null;
  /** (equatorial − polar) / equatorial */
  oblateness: number;
  /** axial tilt, degrees — the one that makes seasons */
  tilt: number;
  /** sidereal rotation, seconds */
  rotation: number | null;
  /** which meridian faced the primary when the era began, degrees */
  meridian: number;
};

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export const wrap360 = (deg: number) => ((deg % 360) + 360) % 360;
export const wrap180 = (deg: number) => wrap360(deg + 180) - 180;

export function bodies(): Record<string, Body> {
  const out: Record<string, Body> = {};
  for (const r of db.rows(
    `SELECT o.*, e.name, p.type FROM orbit o
        JOIN entity e ON e.id = o.id
        LEFT JOIN place p ON p.id = o.id
       ORDER BY o.id`
  )) {
    out[String(r.id)] = {
      id: String(r.id),
      name: String(r.name),
      type: r.type ?? null,
      around: r.around ?? null,
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

/**
 * How long it takes to go round once, in seconds. Kepler's third, with both masses
 * in it — the primary dominates, but the term is real and costs nothing.
 */
export function period(it: Body, known: Record<string, Body> = bodies()): number | null {
  if (!it.semiMajor || !it.around) return null;
  const primary = known[it.around];
  const mass = (primary?.mass ?? 0) + (it.mass ?? 0);
  if (!mass) return null;
  return 2 * Math.PI * Math.sqrt(it.semiMajor ** 3 / (G * mass));
}

/**
 * The day you would actually live through, in seconds. A prograde spin comes back
 * round to face the primary one turn later than it comes back round to face the
 * stars — exactly one turn's worth over a whole orbit.
 */
export function solarDay(it: Body, known: Record<string, Body> = bodies()): number | null {
  const sidereal = it.rotation;
  const year = period(it, known);
  if (!sidereal) return null;
  if (!year || year === sidereal) return sidereal;
  return (sidereal * year) / (year - sidereal);
}

/** How many of its own days a body's year runs to. */
export function daysPerYear(it: Body, known: Record<string, Body> = bodies()): number | null {
  const year = period(it, known);
  const day = solarDay(it, known);
  return year && day ? year / day : null;
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
 * Seconds since the era began. The calendar divides a day into 1440 minutes
 * whatever the day lasts, so a minute is a fraction of the body's day and not a
 * fixed sixty seconds.
 */
export function elapsed(it: Body, when: When, known: Record<string, Body> = bodies()): number | null {
  const day = solarDay(it, known);
  const perYear = daysPerYear(it, known);
  if (!day || !perYear) return null;
  const days =
    Number(when.year ?? 0) * perYear +
    (Number(when.day ?? 1) - 1) +
    Number(when.minute ?? 0) / MINUTES_PER_DAY;
  return days * day;
}

/** How far round its orbit it has got, as an angle from the equinox. */
export function seasonAngle(
  it: Body, when: When, known: Record<string, Body> = bodies()
): number | null {
  const year = period(it, known);
  const since = elapsed(it, when, known);
  if (!year || since === null) return null;
  const mean = it.longitude + 360 * (since / year);
  return wrap360(trueAnomaly(mean - it.periapsis, it.eccentricity) + it.periapsis);
}

/**
 * Where on its orbit a body stands when it is that far round, in metres from the
 * primary. The primary sits at a focus and not at the middle, which is the whole
 * difference an eccentricity makes and the reason this is not a circle.
 */
export function atLongitude(it: Body, deg: number): { x: number; y: number; r: number } | null {
  if (!it.semiMajor) return null;
  const e = it.eccentricity;
  const from = (deg - it.periapsis) * RAD;
  const r = (it.semiMajor * (1 - e * e)) / (1 + e * Math.cos(from));
  return { x: r * Math.cos(deg * RAD), y: r * Math.sin(deg * RAD), r };
}

/** Where it actually is, now. */
export function at(it: Body, when: When, known: Record<string, Body> = bodies()) {
  const angle = seasonAngle(it, when, known);
  if (angle === null) return null;
  const spot = atLongitude(it, angle);
  return spot && { ...spot, angle };
}

/**
 * The four days the tilt turns on: the two the primary stands furthest from the
 * equator, and the two it crosses it. They are found by walking the year rather
 * than by formula, because the year is however many days it is.
 */
export function seasons(it: Body, when: When, known: Record<string, Body> = bodies()) {
  const year = Math.round(daysPerYear(it, known) ?? 0);
  if (!year || !it.tilt) return [];
  const lat: number[] = [];
  for (let day = 1; day <= year; day++) {
    const spot = subsolar(it, { ...when, day, minute: MINUTES_PER_DAY / 2 }, known);
    lat.push(spot ? spot.lat : 0);
  }
  const found: Array<{ name: string; says: string; day: number; lat: number }> = [
    {
      name: "winter-solstice", says: "winter solstice",
      day: lat.indexOf(Math.min(...lat)) + 1, lat: Math.min(...lat),
    },
    {
      name: "summer-solstice", says: "summer solstice",
      day: lat.indexOf(Math.max(...lat)) + 1, lat: Math.max(...lat),
    },
  ];
  for (let n = 0; n < year; n++) {
    const here = lat[n];
    const next = lat[(n + 1) % year];
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
 * The point the primary stands straight over. Its latitude is the season; its
 * longitude is the hour, because the clock is the prime meridian's solar time.
 */
export function subsolar(
  it: Body, when: When, known: Record<string, Body> = bodies()
): { lat: number; lon: number } | null {
  const angle = seasonAngle(it, when, known);
  if (angle === null) return null;
  const lat = Math.asin(Math.sin(it.tilt * RAD) * Math.sin(angle * RAD)) * DEG;
  const lon = wrap180(180 - 360 * (Number(when.minute ?? 0) / MINUTES_PER_DAY) + it.meridian);
  return { lat, lon };
}

/** How high the primary stands over a place, in degrees. Negative is below. */
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
 * How much of the day the primary is above the horizon, in minutes. A latitude the
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

/**
 * The body the calendar is kept on: whatever turns, and is gone round by anything
 * at all. A world with none falls back on the constants, which is how a fresh
 * profile keeps a calendar before anybody has written the sky down.
 */
export function home(known: Record<string, Body> = bodies()): Body | null {
  const turning = Object.values(known).filter((it) => it.rotation && it.semiMajor && it.around);
  return turning.find((it) => !known[it.around!]?.around) ?? turning[0] ?? null;
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
 * The space these bodies are in. It has no orbit row — a system is not a body —
 * so it is found the other way round: whatever holds the thing everything else
 * goes round.
 */
export function system(known: Record<string, Body> = bodies()) {
  const middle = Object.values(known).find((it) => !it.around);
  if (!middle) return null;
  const found = db.row(
    `SELECT e.id, e.name
       FROM place held
       JOIN place holder ON holder.id = held.parent
       JOIN entity e ON e.id = holder.id
      WHERE held.id = ? AND holder.type = 'celestial-system'`,
    [middle.id]
  );
  return found ? { id: String(found.id), name: String(found.name) } : null;
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

/** The whole system as plain data, which is what the map draws. */
export function describe(when: When | null = null, been = new Set<string>()) {
  const known = bodies();
  const out: Record<string, unknown> = {};
  for (const id of Object.keys(known).sort()) {
    const it = known[id];
    const year = period(it, known);
    const day = solarDay(it, known);
    out[id] = {
      ...it,
      period: year,
      solar_day: day,
      days_per_year: daysPerYear(it, known),
      moves: !!year,
      at: when ? at(it, when, known) : null,
      subsolar: when ? subsolar(it, when, known) : null,
      seasons: when ? seasons(it, when, known) : [],
      standing: when ? standing(it, when, known, been) : [],
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
 * sits, and whether the primary is above the horizon there right now.
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
