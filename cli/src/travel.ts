/**
 * The road. How far a thing is written as being, which way it lies, and how much
 * of a walk gets done before something interrupts it.
 */

import { OVER_DRAG } from "./config.ts";
import type { Rng } from "./rng.ts";
import type { ClockT } from "./schema.ts";

export const POINTS = [
  "north", "north-north-east", "north-east", "east-north-east",
  "east", "east-south-east", "south-east", "south-south-east",
  "south", "south-south-west", "south-west", "west-south-west",
  "west", "west-north-west", "north-west", "north-north-west",
];

function compass(): Record<string, number> {
  const table: Record<string, number> = {};
  POINTS.forEach((name, n) => {
    const forms = [
      name,
      name.replace(/-/g, ""),
      name.replace(/-/g, " "),
      name.split("-").map((w) => w[0]).join(""),
    ];
    for (const form of forms) table[form] = n * 22.5;
  });
  return table;
}

export const COMPASS = compass();

export const UNITS: Record<string, number> = {
  m: 1, metre: 1, metres: 1, meter: 1, meters: 1,
  km: 1000, kilometre: 1000, kilometres: 1000, kilometer: 1000, kilometers: 1000,
  mile: 1609, miles: 1609,
  league: 4800, leagues: 4800,
};

const MEASURED = /(\d+(?:\.\d+)?)\s*(?:(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*)?([a-z]+)/;

const PACES: Array<[string, [number, number]]> = [
  ["a few days", [75000, 150000]],
  ["half a day", [15000, 30000]],
  ["a day", [25000, 45000]],
  ["an hour", [3000, 6000]],
  ["a couple of minutes", [100, 300]],
  ["a few minutes", [100, 500]],
  ["a short walk", [200, 1200]],
  ["a short way", [200, 1200]],
  ["a long walk", [4000, 12000]],
];

/**
 * Degrees clockwise from north, or nothing at all where the world never wrote a
 * direction down.
 */
export function bearingDegrees(text: unknown): number | undefined {
  const said = String(text ?? "").toLowerCase().split(/\s+/).filter(Boolean).join(" ")
    .replace(/^[ .,]+|[ .,]+$/g, "");
  return COMPASS[said];
}

/**
 * A low and a high in metres, wide on purpose, or nothing where nobody has
 * measured it — which is most of the roads in this world.
 */
export function distanceBand(text: unknown): [number, number] | null {
  const said = String(text ?? "").toLowerCase().split(/\s+/).filter(Boolean).join(" ");
  if (!said) return null;
  const found = MEASURED.exec(said);
  if (found && UNITS[found[3]] !== undefined) {
    const scale = UNITS[found[3]];
    const low = parseFloat(found[1]) * scale;
    const high = found[2] ? parseFloat(found[2]) * scale : low;
    return [Math.round(low), Math.round(high)];
  }
  for (const [phrase, band] of PACES) if (said.includes(phrase)) return band;
  return null;
}

/** How long a stretch of world-time takes in real seconds, at the current speed. */
export function realDelayMs(clock: ClockT, inWorldMinutes: number): number {
  const factor = Number(clock?.speed_factor) || 1;
  return ((Number(inWorldMinutes) * 60) / factor) * 1000;
}

/**
 * An overloaded back is paid for on the road: every tenth of their capacity they
 * are carrying over it doubles what the walking costs.
 */
export function drag(load: { carried?: number; capacity?: number } | null | undefined): number {
  if (!load || !load.capacity) return 1.0;
  const over = (Number(load.carried) - Number(load.capacity)) / Number(load.capacity);
  return over > 0 ? Number((1 + OVER_DRAG * over).toFixed(3)) : 1.0;
}

/**
 * How far this stretch of road gets before something interrupts it. One coin a
 * league; the first that lands says where the walking stops.
 */
export function leg(
  clock: ClockT, leagues: number, rng: Rng, slowed = 1.0
): [number, number, boolean] {
  const hoursPerLeague = Number(clock.hours_per_league);
  const minLeg = Math.trunc(Number(clock.min_leg_minutes));
  const chance = Number(clock.encounter_chance_per_league);

  const total = Math.max(
    minLeg,
    Math.round(Number(leagues) * hoursPerLeague * 60 * Math.max(1.0, slowed))
  );
  if (total <= minLeg * 2) return [total, 0.0, false];

  for (let n = 0; n < Math.max(1, Math.trunc(leagues)); n++) {
    if (rng.next() >= chance) continue;
    const minutes = rng.int(minLeg, total - minLeg);
    return [minutes, Number((Number(leagues) * (1 - minutes / total)).toFixed(3)), true];
  }
  return [total, 0.0, false];
}

export function arrived(turn: { wake_at?: string | null }, moment: Date): boolean {
  return turn.wake_at != null && new Date(turn.wake_at) <= moment;
}
