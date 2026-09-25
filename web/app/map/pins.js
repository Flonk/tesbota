import { isRun } from "../world";
import { across, down, latOf, lonOf } from "./projection";

/** How many pixels across a place has to be on screen before it opens into what it holds. */
const OPEN = 360;

/** How close two pins may come on the screen, in pixels, before they are one mark. */
const TOUCH = 22;

export function treeOf(standing) {
  const byId = new Map(standing.map((p) => [p.id, p]));
  const kids = new Map();
  for (const place of standing) {
    const parent = byId.has(place.parent) ? place.parent : null;
    if (!kids.has(parent)) kids.set(parent, []);
    kids.get(parent).push(place);
  }
  const ancestors = (id) => {
    const chain = [];
    const seen = new Set([id]);
    for (let at = byId.get(byId.get(id)?.parent); at && !seen.has(at.id); at = byId.get(at.parent)) {
      seen.add(at.id);
      chain.push(at);
    }
    return chain;
  };
  /** Everything nested inside a place, by what says it is inside what. */
  const descendants = (id) => {
    const inside = [];
    const seen = new Set([id]);
    const walk = (at) => {
      for (const kid of kids.get(at) || []) {
        if (seen.has(kid.id)) continue;
        seen.add(kid.id);
        inside.push(kid);
        walk(kid.id);
      }
    };
    walk(id);
    return inside;
  };
  return { byId, kids, ancestors, descendants };
}

/**
 * Which places get a pin at this distance. A place too small on the screen to be
 * looked into is one pin, standing for itself and everything inside it; one big
 * enough opens, loses its pin, and what it holds is asked the same question. So a
 * world map says the plains, and coming down to the plains it says the villages.
 */
export function resolve({ kids, descendants }, sizes, scale, open = null) {
  const pins = [];
  const visit = (place, seen) => {
    if (seen.has(place.id)) return;
    seen.add(place.id);
    const box = sizes.get(place.id);
    const wide = box ? Math.max(box.maxX - box.minX, box.maxY - box.minY) * scale : 0;
    if (wide >= OPEN || place.id === open) {
      for (const kid of kids.get(place.id) || []) visit(kid, seen);
      return;
    }
    const at = place.lat !== null && place.lon !== null
      ? { lat: place.lat, lon: place.lon }
      : box ? { lat: latOf((box.minY + box.maxY) / 2), lon: lonOf((box.minX + box.maxX) / 2) } : null;
    if (at) pins.push({ place, ...at, all: [place, ...descendants(place.id)], wide });
  };
  const seen = new Set();
  for (const top of kids.get(null) || []) visit(top, seen);
  return pins;
}

/**
 * Pins that would sit on top of each other are one mark. The biggest place among
 * them names it, unless the adventurer is standing in one of them.
 */
export function gather(pins, here, scale) {
  const weight = (pin) => (isRun(pin.place.type) ? -1 : pin.wide);
  const groups = [];
  for (const pin of [...pins].sort((a, b) => weight(b) - weight(a) || b.all.length - a.all.length)) {
    const x = across(pin.lon) * scale;
    const y = down(pin.lat) * scale;
    const touching = groups.find((g) => Math.hypot(g.x - x, g.y - y) < TOUCH);
    if (touching) touching.pins.push(pin);
    else groups.push({ x, y, pins: [pin] });
  }
  return groups.map(({ pins: group }) => {
    const all = group.flatMap((pin) => pin.all);
    const holding = group.find((pin) => pin.all.some((p) => p.id === here));
    const lead = holding || group[0];
    return {
      id: lead.place.id,
      name: lead.place.name,
      lat: lead.lat,
      lon: lead.lon,
      day: lead.place.day,
      altitude: lead.place.altitude,
      here: !!holding,
      all,
    };
  });
}

// Two names on top of each other say less than one name does. Whoever you are
// standing with wins, then whoever stands with the most.
export function labelled(marks, near) {
  const kept = [];
  for (const mark of [...marks].sort(
    (a, b) => (b.here ? 1 : 0) - (a.here ? 1 : 0) || b.all.length - a.all.length
  )) {
    const x = across(mark.lon);
    const y = down(mark.lat);
    const crowded = kept.some(
      (was) => Math.abs(was.x - x) < 90 * near && Math.abs(was.y - y) < 26 * near
    );
    if (!crowded) kept.push({ id: mark.id, x, y });
  }
  return new Set(kept.map((was) => was.id));
}
