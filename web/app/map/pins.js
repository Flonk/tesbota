export function treeOf(standing) {
  const byId = new Map(standing.map((p) => [p.id, p]));
  const kids = new Map();
  for (const place of standing) {
    const parent = byId.has(place.parent) ? place.parent : null;
    if (!kids.has(parent)) kids.set(parent, []);
    kids.get(parent).push(place);
  }
  const up = (id) => {
    const chain = [];
    const seen = new Set([id]);
    for (let at = byId.get(byId.get(id)?.parent); at && !seen.has(at.id); at = byId.get(at.parent)) {
      seen.add(at.id);
      chain.push(at);
    }
    return chain;
  };
  /** Everything nested inside a place, by what says it is inside what. */
  const down = (id) => {
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
  return { byId, kids, up, down };
}
