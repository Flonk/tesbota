import type { Ctx } from "./index.ts";
import { CELESTIAL } from "../config.ts";
import { typeAfter } from "./place.ts";
import { fields, number } from "./shared.ts";

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

export default function orbit(con: any, id: string, value: unknown, ctx: Ctx) {
  if (ctx.kind !== "places") throw new Error(`${id} is not a place, so it has no orbit`);
  const type = typeAfter(con, id, ctx);
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
  con.prepare("INSERT OR IGNORE INTO orbit (id) VALUES (?)").run(id);
  const keys = Object.keys(set);
  if (!keys.length) return;
  con
    .prepare(`UPDATE orbit SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
    .run(...keys.map((k) => set[k]), id);
}
