import type { DatabaseSync } from "node:sqlite";
import { CELESTIAL } from "../config.ts";
import { typeAfter } from "./place.ts";
import { fields, number, upsert } from "./shared.ts";

const WORDS: Record<string, string> = {
  semi_major: "semi-major axis",
  eccentricity: "eccentricity",
  longitude: "longitude",
  periapsis: "periapsis",
  mass: "mass",
  radius: "radius",
  oblateness: "oblateness",
  tilt: "axial tilt",
  rotation: "sidereal rotation",
  meridian: "meridian",
};
const ZEROED = ["eccentricity", "longitude", "periapsis", "oblateness", "tilt", "meridian"];
const POSITIVE = ["mass", "radius", "rotation"];

export default function orbit(con: DatabaseSync, id: string, value: unknown, all: Record<string, unknown>) {
  const type = typeAfter(con, id, all);
  if (!CELESTIAL.includes(String(type))) throw new Error("only a celestial-body or a celestial-system has an orbit");
  const got = fields(value, "orbit", Object.keys(WORDS));
  const set: Record<string, number | null> = {};
  for (const [key, raw] of Object.entries(got)) {
    let n = number(raw, WORDS[key]);
    if (n === null && ZEROED.includes(key)) n = 0;
    if (n !== null && POSITIVE.includes(key) && n <= 0) throw new Error(`${WORDS[key]} has to be more than 0`);
    if (key === "semi_major" && n !== null && n < 0) throw new Error("semi-major axis cannot be less than 0");
    if (key === "eccentricity" && n !== null && (n < 0 || n >= 1)) throw new Error("eccentricity is at least 0 and less than 1");
    set[key] = n;
  }
  upsert(con, "orbit", id, set);
}
