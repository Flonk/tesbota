/**
 * Time on the road: how long a stretch of world-time takes, and how much of a walk
 * gets done before something interrupts it.
 */

import type { Rng } from "./rng.ts";
import type { PaceT } from "./schema.ts";

export const POINTS = [
  "north", "north-north-east", "north-east", "east-north-east",
  "east", "east-south-east", "south-east", "south-south-east",
  "south", "south-south-west", "south-west", "west-south-west",
  "west", "west-north-west", "north-west", "north-north-west",
];

/** How long a stretch of world-time takes in real seconds, at the current speed. */
export function realDelayMs(pace: PaceT, inWorldMinutes: number): number {
  const factor = Number(pace?.speed_factor) || 1;
  return ((Number(inWorldMinutes) * 60) / factor) * 1000;
}

/**
 * How far this stretch of road gets before something interrupts it. One coin a
 * league; the first that lands says where the walking stops.
 */
export function leg(
  pace: PaceT, leagues: number, rng: Rng, slowed = 1.0
): [number, number, boolean] {
  const hoursPerLeague = Number(pace.hours_per_league);
  const minLeg = Math.trunc(Number(pace.min_leg_minutes));
  const chance = Number(pace.encounter_chance_per_league);

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
