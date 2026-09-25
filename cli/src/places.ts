/**
 * Where everything is: what a place sits inside, what sits inside it, and the one
 * way the map itself writes to the record.
 */

import fs from "node:fs";
import path from "node:path";
import * as db from "./db.ts";
import { slug } from "./canon.ts";
import { HEAVENS, PLACE_TYPE_NAMES, PROFILES, roomOf, WIDE } from "./config.ts";
import { type Affine, area, carriedTo, covers, dragged, interior, pinOf, runsIn, shapeOf, still } from "./geo.ts";

export type PlaceRow = {
  id: string; name: string; type: string | null; parent: string | null;
  lat: number | null; lon: number | null; extent: string | null; width: number | null;
};

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** The world a place is on, however deep it sits. */
export function worldOf(id: string): string | null {
  const found = db.row(
    `WITH RECURSIVE up(id, depth) AS (
       SELECT ?, 0
       UNION
       SELECT p.parent, up.depth + 1 FROM place p JOIN up ON p.id = up.id
        WHERE up.depth < 32 AND p.parent IS NOT NULL
     )
     SELECT up.id FROM up JOIN place p ON p.id = up.id
      WHERE p.type = 'celestial-body' ORDER BY up.depth LIMIT 1`,
    [id]
  );
  return found ? String(found.id) : null;
}

export function ancestry(placeId: string): Array<{ id: string; name: string }> {
  const found = db.rows(
    `WITH RECURSIVE up(id, depth) AS (
       SELECT ?, 0
       UNION
       SELECT p.parent, up.depth + 1 FROM place p JOIN up ON p.id = up.id
        WHERE up.depth < 32 AND p.parent IS NOT NULL
     )
     SELECT up.id, coalesce(entity.name, replace(up.id, '-', ' ')) AS name, up.depth
       FROM up LEFT JOIN entity ON entity.id = up.id
      ORDER BY up.depth DESC`,
    [slug(placeId)]
  );
  return found.filter((r) => r.id).map((r) => ({ id: String(r.id), name: String(r.name) }));
}

export function placesUnder(world: string): PlaceRow[] {
  return db
    .rows(
      `WITH RECURSIVE under(id) AS (
         SELECT ?
         UNION
         SELECT p.id FROM place p JOIN under u ON p.parent = u.id
       )
       SELECT p.id, e.name, p.type, p.parent, p.lat, p.lon, e.extent, p.width
         FROM place p JOIN entity e ON e.id = p.id
        WHERE p.id IN (SELECT id FROM under)
          AND p.id <> ?
        ORDER BY lower(e.name)`,
      [world, world]
    )
    .map((r) => ({
      id: String(r.id),
      name: String(r.name),
      type: r.type ?? null,
      parent: r.parent ?? null,
      lat: num(r.lat),
      lon: num(r.lon),
      extent: r.extent ?? null,
      width: num(r.width),
    }));
}

export type Carry = Affine | null;

/**
 * Set the shape of a place.
 *
 * The one way the map itself writes to the record. It checks the shape rather
 * than trusting it: a polygon that does not close, a point outside the world, a
 * run of one point — none of those are a place, and a map that saved them would
 * be quietly unreadable afterwards.
 */
export function shape(
  id: string, extent: string | null | undefined, carry: Carry = null, width: number | null | undefined = undefined, alone = false
) {
  const ident = String(id || "").trim().toLowerCase();
  if (!ident) return { error: "no place named" };

  const there = db.row("SELECT kind FROM entity WHERE id = ?", [ident]);
  if (!there) return { error: `no such place: ${ident}` };
  if (there.kind !== "places") return { error: `${ident} is not a place` };

  if (width !== undefined) {
    if (width !== null && !(Number.isFinite(width) && width > 0)) return { error: "a width is a number of metres" };
    const kind = db.value<string>("SELECT type FROM place WHERE id = ?", [ident]);
    if (width !== null && !WIDE.includes(String(kind))) return { error: "only a road or a river has a width" };
    db.writing((con) => con.prepare("UPDATE place SET width = ? WHERE id = ?").run(width, ident));
    if (extent === undefined) return { ok: true, id: ident, width };
  }

  if (extent === undefined) return { error: "no shape given" };
  if (extent === null || extent === "") {
    db.writing((con) => con.prepare("UPDATE entity SET extent = NULL WHERE id = ?").run(ident));
    return { ok: true, id: ident, extent: null };
  }

  let drawn: { type?: unknown; coordinates?: unknown } | null;
  try {
    drawn = JSON.parse(extent);
  } catch {
    return { error: "that is not json" };
  }

  const KINDS: unknown[] = ["LineString", "Polygon", "MultiPolygon"];
  if (!drawn || !KINDS.includes(drawn.type)) {
    return { error: `a shape is one of ${KINDS.join(", ")}` };
  }

  const runs = runsIn(drawn.coordinates);
  if (!runs.length) return { error: "that shape has no points in it" };

  const shut = drawn.type !== "LineString";
  for (const run of runs) {
    if (run.length < (shut ? 4 : 2)) {
      return { error: shut ? "a ring needs three corners and a close" : "a run needs two points" };
    }
    for (const point of run) {
      const [lon, lat] = point;
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return { error: "a point is not a number" };
      if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
        return { error: `${lon}, ${lat} is off the world` };
      }
    }
    if (shut) {
      const [first, last] = [run[0], run[run.length - 1]];
      if (first[0] !== last[0] || first[1] !== last[1]) return { error: "a ring has to close" };
    }
  }

  const said = JSON.stringify(drawn);
  const before = db.value<string>("SELECT extent FROM entity WHERE id = ?", [ident]);
  db.writing((con) => con.prepare("UPDATE entity SET extent = ? WHERE id = ?").run(said, ident));

  // Ground picked up and set down elsewhere takes what stood on it. What counts
  // as standing on it is judged against where it was, not where it now is —
  // otherwise a shape moved clear of its own village would carry nothing.
  const carried: string[] = [];
  const world = worldOf(ident);
  const pin = db.row("SELECT lat, lon FROM place WHERE id = ?", [ident]);
  let lat = num(pin?.lat);
  let lon = num(pin?.lon);
  if (carry && !still(carry) && lat !== null && lon !== null) [lon, lat] = carriedTo(carry, [lon, lat]);
  const rings = shut ? shapeOf(said).rings : [];
  if (rings.length && lat !== null && lon !== null && !covers(rings, [lon, lat])) {
    const inside = interior(rings);
    if (inside) [lon, lat] = inside;
  }
  if (lat !== null && lon !== null && (lat !== Number(pin?.lat) || lon !== Number(pin?.lon))) {
    db.writing((con) => con.prepare("UPDATE place SET lat = ?, lon = ? WHERE id = ?").run(lat, lon, ident));
  }
  if (carry && !still(carry) && !alone) {
    const held = shapeOf(before ?? null).rings;
    const size = area(held);
    const above = new Set(ancestry(ident).slice(0, -1).map((a) => a.id));
    if (held.length) {
      const inside = db
        .rows(
          `SELECT p.id, p.lat, p.lon, e.extent FROM place p JOIN entity e ON e.id = p.id
            WHERE p.id <> ? AND ((p.lat IS NOT NULL AND p.lon IS NOT NULL) OR e.extent IS NOT NULL)`,
          [ident]
        )
        .map((r) => ({ id: String(r.id), lat: num(r.lat), lon: num(r.lon), extent: r.extent ?? null, ...shapeOf(r.extent ?? null) }))
        .filter((r) => {
          const at = pinOf(r);
          const own = area(r.rings);
          return !!at && covers(held, at) && (!own || own < size);
        })
        .filter((r) => !above.has(r.id) && (!world || worldOf(r.id) === world));
      db.writing((con) => {
        for (const r of inside) {
          if (r.lat !== null && r.lon !== null) {
            const [lon, lat] = carriedTo(carry, [r.lon, r.lat]);
            con.prepare("UPDATE place SET lat = ?, lon = ? WHERE id = ?").run(lat, lon, r.id);
          }
          const shifted = r.extent ? dragged(r.extent, carry) : null;
          if (shifted) {
            con.prepare("UPDATE entity SET extent = ? WHERE id = ?").run(shifted, r.id);
          }
          carried.push(r.id);
        }
      });
    }
  }

  // A shape that moved may now hold things it did not, or have let things go.
  const moved = world ? restack(world) : [];

  return {
    ok: true, id: ident, extent: said,
    points: runs.reduce((n, r) => n + r.length, 0),
    carried,
    moved,
  };
}

/**
 * Put every place back inside whatever is actually drawn around it.
 *
 * What holds what stops being something anybody types and becomes something the
 * shapes say: a place belongs to the smallest ground that covers the point it is
 * named at. Draw a wall round a village and the houses inside it are its houses;
 * pull the wall in until a mill is outside and the mill belongs to the plain
 * again — both fall out of the one rule rather than being two cases.
 *
 * A place with nothing drawn around it falls back to the world it is on, because
 * everything on a world is at least on the world.
 */
export function restack(ground: string) {
  // Everything not of the heavens, whether or not it can still be walked down to
  // from the world. A place whose parent has been taken out of the record is
  // reachable from nowhere and would otherwise simply stop existing — and since
  // where a place belongs is decided by its shape, it can be put back.
  const all = db.rows(
    `WITH RECURSIVE elsewhere(id) AS (
       SELECT id FROM place WHERE type = 'celestial-body' AND id <> ?
       UNION
       SELECT p.id FROM place p JOIN elsewhere w ON p.parent = w.id
     )
     SELECT p.id, p.parent, p.type, p.lat, p.lon, e.extent
       FROM place p JOIN entity e ON e.id = p.id
      WHERE p.id <> ?
        AND p.id NOT IN (SELECT id FROM elsewhere)`,
    [ground, ground]
  ).filter((r) => !HEAVENS.includes(r.type ?? ""));

  const held = all.map((r) => {
    const place = {
      id: String(r.id),
      parent: r.parent ?? null,
      lat: num(r.lat),
      lon: num(r.lon),
      ...shapeOf(r.extent ?? null),
    };
    return { ...place, pin: pinOf(place), size: area(place.rings) };
  });
  const by = new Map(held.map((p) => [p.id, p]));

  const moved: Array<{ id: string; from: string | null; to: string }> = [];
  const wanted = new Map<string, string>();

  for (const place of held) {
    if (!place.pin) continue;
    let best: { id: string; size: number } | null = null;
    for (const other of held) {
      if (other.id === place.id || !other.rings.length) continue;
      if (!covers(other.rings, place.pin)) continue;
      if (place.size && other.size <= place.size) continue;
      if (!best || other.size < best.size) best = other;
    }
    wanted.set(place.id, best?.id ?? ground);
  }

  // A shape drawn inside a shape it already holds would make a ring of parents,
  // and a world where everywhere is inside everywhere is nowhere at all.
  const loops = (id: string, parent: string) => {
    const seen = new Set([id]);
    let at: string | null = parent;
    for (let n = 0; at && n < 64; n++) {
      if (seen.has(at)) return true;
      seen.add(at);
      at = wanted.get(at) ?? by.get(at)?.parent ?? null;
    }
    return false;
  };

  db.writing((con) => {
    for (const [id, parent] of wanted) {
      const place = by.get(id)!;
      if (place.parent === parent || loops(id, parent)) continue;
      con.prepare("UPDATE place SET parent = ? WHERE id = ?").run(parent, id);
      moved.push({ id, from: place.parent, to: parent });
    }
  });
  return moved;
}

/**
 * Write down a place that did not exist, with nothing said about it but its name
 * and what sort of thing it is.
 *
 * It is put on whatever holds it for now; where it actually belongs is settled by
 * `restack` the moment somebody draws it, because what holds what is a question
 * the shapes answer.
 */
export function makePlace(name: string, type: string, on: string) {
  const said = String(name || "").trim();
  if (!said) return { error: "a place needs a name" };
  if (!PLACE_TYPE_NAMES.includes(type)) {
    return { error: `a place is one of ${PLACE_TYPE_NAMES.join(", ")}` };
  }
  const holder = String(on || "").trim().toLowerCase();
  if (!db.row("SELECT 1 FROM place WHERE id = ?", [holder])) {
    return { error: `nothing called ${holder} to put it in` };
  }

  let ident = slug(said);
  if (!ident) return { error: "that name makes no id" };
  if (db.row("SELECT 1 FROM entity WHERE id = ?", [ident])) {
    let n = 2;
    while (db.row("SELECT 1 FROM entity WHERE id = ?", [`${ident}-${n}`])) n += 1;
    ident = `${ident}-${n}`;
  }

  db.writing((con) => {
    con.prepare("INSERT INTO entity (id, kind, name, about) VALUES (?,?,?,?)")
      .run(ident, "places", said, "$BOTA");
    con.prepare("INSERT INTO place (id, parent, type) VALUES (?,?,?)").run(ident, holder, type);
  });
  return { ok: true, id: ident, name: said, type, on: holder };
}

/**
 * Everywhere anybody is standing, across every life being walked.
 *
 * One world, more than one adventurer in it. Asking only the profile that happens
 * to be running would let a map open as one walker strike the ground out from
 * under another.
 */
function trodden(): Set<string> {
  const feet = new Set<string>();
  for (const profile of PROFILES) {
    let held: { location?: string | null; location_path?: Array<string | { id: string }> };
    try {
      held = JSON.parse(fs.readFileSync(path.join(roomOf(profile), "campaign.json"), "utf8"));
    } catch {
      continue;
    }
    for (const step of [held.location, ...(held.location_path || [])]) {
      const ident = step && typeof step === "object" ? step.id : step;
      if (ident) feet.add(String(ident));
    }
  }
  return feet;
}

/**
 * Take a place out of the record.
 *
 * What was inside it has to go somewhere. By default it goes up: a mill whose
 * village is struck out is still a mill, and still on the plain the village stood
 * on. Say `deep` and the whole nest goes with it, which is the other thing a
 * person can mean and never the thing they mean by accident.
 *
 * The heavens are not deleted from here — a world with no world is not a shorter
 * record, it is a broken one — and neither is the ground somebody is standing on.
 */
export function unmakePlace(id: string, deep = false) {
  const ident = String(id || "").trim().toLowerCase();
  const there = db.row("SELECT type, parent FROM place WHERE id = ?", [ident]);
  if (!there) return { error: `no such place: ${ident}` };
  if (HEAVENS.includes(String(there.type))) {
    return { error: `${ident} is a ${there.type}, and the sky is not edited from the map` };
  }

  const standing = trodden();

  const kin: string[] = [];
  if (deep) {
    const walk = (at: string) => {
      for (const r of db.rows("SELECT id FROM place WHERE parent = ?", [at])) {
        const child = String(r.id);
        if (kin.includes(child)) continue;
        kin.push(child);
        walk(child);
      }
    };
    walk(ident);
  }

  const going = [ident, ...kin];
  const under = going.filter((p) => standing.has(p));
  if (under.length) {
    return { error: `the adventurer is standing in ${under.join(", ")}` };
  }

  db.writing((con) => {
    if (!deep) {
      con.prepare("UPDATE place SET parent = ? WHERE parent = ?").run(there.parent ?? null, ident);
    }
    for (const gone of going) {
      con.prepare("DELETE FROM way WHERE src = ? OR dst = ?").run(gone, gone);
      con.prepare("DELETE FROM holding WHERE holder = ?").run(gone);
      con.prepare("DELETE FROM place WHERE id = ?").run(gone);
      con.prepare("DELETE FROM entity WHERE id = ?").run(gone);
    }
  });

  // Whatever was handed up is placed again by what it is drawn as, not by where
  // the row it used to sit under happened to be.
  const world = there.parent ? worldOf(String(there.parent)) : null;
  const moved = world ? restack(world) : [];
  return { ok: true, id: ident, removed: going, deep, moved };
}
