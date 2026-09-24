import type { Ctx } from "./index.ts";
import { fields, named, number, oneOf } from "./shared.ts";

export const TYPES = ["location", "region", "road", "river", "water", "celestial-body", "celestial-system", "realm"] as const;
export const CELESTIAL = ["celestial-body", "celestial-system"];
const WIDE = ["road", "river"];

/** The type a place will have once the whole patch is in. */
export function typeAfter(con: any, id: string, ctx: Ctx): string | null {
  const next = ctx.all.place as Record<string, unknown> | null | undefined;
  if (next && typeof next === "object" && "type" in next) return oneOf(next.type, "type", TYPES);
  const row = con.prepare("SELECT type FROM place WHERE id = ?").get(id) as { type?: string } | undefined;
  return row?.type ?? null;
}

export default function place(con: any, id: string, value: unknown, ctx: Ctx) {
  if (ctx.kind !== "places") throw new Error(`${id} is not a place`);
  const got = fields(value, "place", ["type", "parent", "lat", "lon", "width"]);
  const was = (con.prepare("SELECT type, parent, lat, lon, width FROM place WHERE id = ?").get(id) ?? {
    type: null, parent: null, lat: null, lon: null, width: null,
  }) as Record<string, any>;
  const row = { ...was };

  if ("type" in got) row.type = oneOf(got.type, "type", TYPES);

  if ("parent" in got) {
    const parent = named(con, got.parent, "inside", "places");
    if (parent === id) throw new Error("a place cannot be inside itself");
    const seen = new Set<string>();
    for (let at = parent; at && !seen.has(at); ) {
      if (at === id) throw new Error(`${parent} is already inside ${id}, so ${id} cannot be inside it`);
      seen.add(at);
      at = (con.prepare("SELECT parent FROM place WHERE id = ?").get(at) as { parent?: string } | undefined)?.parent ?? null;
    }
    row.parent = parent;
  }

  if ("lat" in got) {
    const lat = number(got.lat, "latitude");
    if (lat !== null && (lat < -90 || lat > 90)) throw new Error("latitude is between -90 and 90");
    row.lat = lat;
  }
  if ("lon" in got) {
    const lon = number(got.lon, "longitude");
    if (lon !== null && (lon < -180 || lon > 180)) throw new Error("longitude is between -180 and 180");
    row.lon = lon;
  }

  const wide = WIDE.includes(String(row.type));
  if ("width" in got) {
    const width = number(got.width, "width");
    if (width !== null && !wide) throw new Error("only a road or a river has a width");
    if (width !== null && width <= 0) throw new Error("width has to be more than 0");
    row.width = width;
  } else if (!wide) {
    row.width = null;
  }

  if (row.type !== was.type) {
    const kids = con.prepare("SELECT p.type FROM place p WHERE p.parent = ?").all(id) as { type: string | null }[];
    const sky = kids.filter((k) => CELESTIAL.includes(String(k.type))).length;
    const ground = kids.length - sky;
    if (!CELESTIAL.includes(String(row.type)) && sky) {
      throw new Error(`${id} has worlds or systems inside it, so it cannot be a ${row.type ?? "place without a type"}`);
    }
    if (row.type === "celestial-system" && ground) {
      throw new Error(`${id} has ground inside it, so it cannot be a celestial-system`);
    }
  }

  con
    .prepare(
      `INSERT INTO place (id, type, parent, lat, lon, width) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET type = excluded.type, parent = excluded.parent,
         lat = excluded.lat, lon = excluded.lon, width = excluded.width`
    )
    .run(id, row.type, row.parent, row.lat, row.lon, row.width);
}
