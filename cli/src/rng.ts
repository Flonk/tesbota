/**
 * Dice. The driver rolls and nobody argues, so the one thing that matters is that
 * a roll can be made repeatable when something needs proving — a seeded fight runs
 * the same twice, which is how the combat maths gets tested without an agent.
 */

export type Rng = {
  /** a float in [0, 1) */
  next(): number;
  /** an integer in [low, high], both ends included, the way Python's randint is */
  int(low: number, high: number): number;
  /** one of these, each as likely as the next */
  pick<T>(from: readonly T[]): T;
  /** one of these, each as likely as its weight */
  weighted<T>(from: readonly T[], weights: readonly number[]): T;
};

function make(next: () => number): Rng {
  const rng: Rng = {
    next,
    int(low, high) {
      const lo = Math.ceil(Math.min(low, high));
      const hi = Math.floor(Math.max(low, high));
      return lo + Math.floor(next() * (hi - lo + 1));
    },
    pick(from) {
      return from[rng.int(0, from.length - 1)];
    },
    weighted(from, weights) {
      const total = weights.reduce((a, b) => a + b, 0);
      if (total <= 0) return rng.pick(from);
      let edge = next() * total;
      for (let i = 0; i < from.length; i++) {
        edge -= weights[i];
        if (edge < 0) return from[i];
      }
      return from[from.length - 1];
    },
  };
  return rng;
}

export const random: Rng = make(Math.random);

/** A seeded stream — mulberry32, which is small and good enough for dice. */
export function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return make(() => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
}
