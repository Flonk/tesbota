"use client";

export const KINDS = ["places", "people", "books", "items", "aspects", "abilities"];

export const KIND_ICON = {
  places: "pin", people: "people", books: "book", items: "box", aspects: "aspect", abilities: "pulse",
};

export const RARITIES = ["common", "uncommon", "rare", "epic", "legendary", "unique"];

export const SLOTS = ["helmet", "chest", "legs", "feet", "mainhand", "offhand", "ring"];

const ICON = {
  weapon: "sword", apparel: "shirt", consumable: "flask", tool: "hammer", valuable: "coin", material: "sack",
};

export const PLACE_ICON = {
  location: "pin", region: "map", road: "map", river: "river", water: "river",
  "celestial-body": "world", "celestial-system": "orbit", realm: "realm",
};

export const PLACE_TYPES = Object.keys(PLACE_ICON);

export const isRun = (type) => type === "road" || type === "river";

const APPAREL_ICON = {
  helmet: "helm", chest: "shirt", legs: "trousers", feet: "boot", offhand: "shield", ring: "ring",
};

export const face = (item) =>
  (item?.type === "apparel" && APPAREL_ICON[item?.slot]) || ICON[item?.type] || "box";

export const does = (item) =>
  (item?.effects || []).map((e) => `${e.amount} ${e.stat}`).join(", ");

export const lit = (item) => (item?.worn ? "worn" : `tint-${item?.rarity || "common"}`);

export const rare = (name) => (
  <span className={`rare-${name}`}>{String(name || "").replace(/_/g, " ")}</span>
);

export const given = (who) => String(who || "").split(" ")[0];

export function abilityLine(a) {
  return [
    a.damage ? `${a.damage} dmg` : null,
    a.spawn ? `calls ${a.spawn.count || 1} × ${a.spawn.name}` : null,
    a.advantage ? "advantage" : null,
    a.cooldown ? `cooldown ${a.cooldown}` : null,
    a.delay ? `arrives ${a.delay} round${a.delay > 1 ? "s" : ""} later` : null,
    a.sleep ? `sleep ${a.sleep}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function abilityWhere(a) {
  return [
    a.within ? `within ${a.within.replace(/-/g, " ")}` : null,
    a.in_aspect ? `somewhere ${a.in_aspect.replace(/-/g, " ")}` : null,
    a.in_kind ? `in a ${a.in_kind.replace(/-/g, " ")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
