/**
 * Where everything is, and where the explorer has been.
 *
 * There used to be a solver here. The world wrote down bearings and distances, and
 * a seeded force-directed relaxation turned them into a picture — because no place
 * carried a position and one had to be guessed for every one of them.
 *
 * That is over. Every place now carries its own `lat`/`lon` and its own `extent`,
 * so there is nothing left to solve: a shape written down is a shape, and the map
 * draws it where the record puts it. What survives here is what was never about
 * guessing — reading the places out, and finding the middle of a written shape.
 */

import * as db from "./db.ts";

export type Place = {
  name: string;
  extent: string | null;
  lat: number | null;
  lon: number | null;
  parent: string | null;
  children: string[];
};

/** Metres to a degree of latitude; longitude shrinks by the cosine of where you are. */
export const PER_DEGREE = 111320;

export function places(): Record<string, Place> {
  const known: Record<string, Place> = {};
  for (const r of db.rows(
    `SELECT e.id, e.name, e.extent, p.lat, p.lon
       FROM entity e LEFT JOIN place p ON p.id = e.id
      WHERE e.kind = 'places' ORDER BY e.id`
  )) {
    known[String(r.id)] = {
      name: String(r.name),
      extent: r.extent ?? null,
      lat: r.lat ?? null,
      lon: r.lon ?? null,
      parent: null,
      children: [],
    };
  }
  for (const r of db.rows(
    "SELECT id AS src, parent AS dst FROM place WHERE parent IS NOT NULL ORDER BY id"
  )) {
    const src = String(r.src);
    const dst = String(r.dst);
    if (known[src] && known[dst] && src !== dst) {
      known[src].parent = dst;
      known[dst].children.push(src);
    }
  }
  return known;
}

/**
 * The middle of a measured shape, in degrees — GeoJSON writes a point as
 * `[lon, lat]` and this hands it back the same way round.
 */
export function centre(extent: string | null): [number, number] | null {
  let shape: any;
  try {
    shape = JSON.parse(String(extent));
  } catch {
    return null;
  }
  const points: Array<[number, number]> = [];
  const walk = (node: any) => {
    if (!Array.isArray(node)) return;
    if (node.length === 2 && node.every((v) => typeof v === "number")) {
      points.push([node[0], node[1]]);
      return;
    }
    for (const child of node) walk(child);
  };
  walk(shape?.coordinates);
  if (!points.length) return null;
  return [
    points.reduce((a, p) => a + p[0], 0) / points.length,
    points.reduce((a, p) => a + p[1], 0) / points.length,
  ];
}

export const knowledge = (ident: string, been: Set<string>) =>
  been.has(ident) ? "walked" : "recorded";
