/**
 * Combat. The explorer picks each blow, the driver rolls it, and nobody argues.
 *
 * Two things are load-bearing here and were learned the hard way. A body is
 * addressed by id, never held — the turn goes to disk between the asking and the
 * swing, and a held body comes back as a copy that every wound lands on harmlessly.
 * And a fight is adjudicated once, at its muster, because a blow is a particular
 * and particulars were never the lore master's to rule on.
 */

import * as canon from "./canon.ts";
import * as sheet from "./sheet.ts";
import {
  DEFENSE_HALVES, EXPLORER, MAX_HEALTH, SKILL_DIE, UNARMED,
} from "./config.ts";
import { explorerName } from "./state.ts";
import type { Rng } from "./rng.ts";
import type { CampaignT } from "./schema.ts";

export type Fighter = Record<string, any>;
export type Fight = Record<string, any>;
export type Blow = Record<string, any>;

export const BAND = /(\d+)\s*[–—-]\s*(\d+)|^\s*(\d+)\s*$/;

/**
 * A damage band the way the item table writes one — `1–2`, `2-5`, or a bare
 * number. Anything that does not read as one is a bare-handed blow.
 */
export function band(said: unknown, rng: Rng): number {
  const found = BAND.exec(String(said ?? "")) || BAND.exec(UNARMED)!;
  if (found[3]) return Number(found[3]);
  const low = Number(found[1]);
  const high = Number(found[2]);
  return rng.int(Math.min(low, high), Math.max(low, high));
}

/** The worst a band can do, for a fumble. */
export function bandtop(said: unknown): number {
  const found = BAND.exec(String(said ?? "")) || BAND.exec(UNARMED)!;
  return Number(found[3] ?? Math.max(Number(found[1]), Number(found[2])));
}

/** What a body has on adds up, whoever it is. Nothing carried but not worn counts. */
export function wornDefense(holder: string = EXPLORER): number {
  let total = 0;
  for (const held of canon.holdings(holder)) {
    if (!held.worn) continue;
    for (const e of held.effects || []) {
      if (e.stat !== "defense") continue;
      const n = parseInt(String(e.amount).replace(/[^0-9-]/g, ""), 10);
      if (!Number.isNaN(n)) total += n;
    }
  }
  return total;
}

/**
 * What they are holding. Worn, a weapon, and carrying a damage band — anything
 * else and they are swinging a fist, which is no worse than a stick.
 */
export function swungWith(campaign: CampaignT): [string, string] {
  for (const held of canon.holdings(EXPLORER)) {
    if (held.worn && held.type === "weapon") {
      const hurt = (held.effects || []).find((e) => e.stat === "damage")?.amount;
      if (hurt) return [held.name, String(hurt)];
    }
  }
  return ["bare hands", UNARMED];
}

/**
 * One body in a fight, on either side. What it is comes off its record, so a Rat
 * is the same Rat every time; what the game master wrote stands over the record
 * for this fight only and is never written back.
 */
export function fighter(said: Record<string, any>, kind: string, fallbackDc = 11): Fighter {
  const ident = canon.slug(said.who || said.name || kind);
  const kept = (canon.body(ident) || {}) as Record<string, any>;
  const written = canon.called(ident);

  const take = (field: string, fallback?: any) => {
    const saidIt = said[field];
    if (saidIt !== undefined && saidIt !== null && saidIt !== "") return saidIt;
    const held = kept[field];
    return held === undefined || held === null || held === "" ? fallback : held;
  };

  const health = Math.trunc(Number(take("health")) || 10);
  return {
    id: ident,
    as_written: { ...said },
    name: String(said.name || written || said.who || kind),
    kind,
    health,
    most: Math.trunc(Number(said.most) || health),
    opened: health,
    damage: String(take("damage") || UNARMED),
    dc: Math.trunc(Number(take("dc")) || fallbackDc),
    bonus: Math.trunc(Number(take("bonus")) || 0),
    defense: Math.trunc(Number(take("defense")) || 0) + wornDefense(ident),
    skill: String(take("skill") || "").toLowerCase() || null,
    ability: said.ability || null,
    asleep: 0,
    cool: 0,
    dead: false,
  };
}

/**
 * Bodies the game master named that the world has no row for. Everything else in
 * a fight is a thing already written down, and is met as what it is.
 */
export const unbound = (fight: Fight): Fighter[] =>
  [...fight.them, ...fight.us.slice(1)].filter((x: Fighter) => !canon.called(x.id));

/**
 * A body the lore master matched to something already recorded. It comes back as
 * that thing, with that thing's stats, keeping whatever the game master wrote
 * over them and whatever it called it in the scene.
 */
export function rebind(fight: Fight, declared: string, bound: string): Fighter | null {
  for (const side of ["them", "us"] as const) {
    for (let at = 0; at < fight[side].length; at++) {
      const who = fight[side][at];
      if (who.id !== declared) continue;
      const said = { ...(who.as_written || {}) };
      said.who = bound;
      if (said.name === undefined) said.name = who.name;
      fight[side][at] = fighter(said, who.kind);
      return fight[side][at];
    }
  }
  return null;
}

/** Every place they are inside, innermost first. */
export function standingOn(campaign: CampaignT): string[] {
  const chain = [
    campaign.location,
    ...[...(campaign.location_path || [])].reverse().map((x: any) =>
      x && typeof x === "object" ? x.id : x
    ),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of chain) {
    if (x && !seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

/** Whether what a body can do counts on the ground it is standing on. */
export function countsHere(power: Record<string, any>, campaign: CampaignT): boolean {
  const ground = new Set(standingOn(campaign));
  if (power.within && !ground.has(canon.slug(power.within))) return false;
  if (power.in_kind) {
    const sat = canon.findPlace(campaign.location);
    if (!sat || sat.type !== power.in_kind) return false;
  }
  if (power.in_aspect && ![...ground].some((x) => canon.markedWith(x, power.in_aspect))) {
    return false;
  }
  return true;
}

export const STAND_IN = /\$([A-Z_]+)_NAME/;

/**
 * `$GUARDED_NAME Guard` is an Alheim Guard in Alheim and a Greater Plains Guard on
 * the road between. The token names an aspect; whoever answers is the nearest
 * place around them carrying it.
 */
export function namedFor(text: unknown, campaign: CampaignT): string {
  return String(text ?? "").replace(/\$([A-Z_]+)_NAME/g, (whole, token: string) => {
    const want = token.toLowerCase().replace(/_/g, "-");
    for (const place of standingOn(campaign)) {
      if (canon.markedWith(place, want)) {
        const known = canon.findEntity(place);
        return known ? String(known.name) : place.replace(/-/g, " ");
      }
    }
    return whole;
  });
}

/**
 * What a body is marked with, and what its markings hand it here. A citizen is
 * only worth anything where the mark says it is.
 */
export function borne(who: Fighter, campaign: CampaignT): Fighter {
  const marks = canon.aspectsOf(who.id);
  who.aspects = marks.map((m) => ({ name: m.name, value: m.value, of: m.of }));
  if (who.ability) return who;
  for (const mark of marks) {
    for (const found of canon.abilitiesOf(mark.aspect)) {
      if (!countsHere(found, campaign)) continue;
      const power: Record<string, any> = { ...found, from: mark.name };
      if (power.spawn) {
        const called = namedFor(power.spawn.name, campaign);
        // Nobody to answer means nobody comes. A citizen out on the road can
        // shout as long as they like.
        if (STAND_IN.test(called)) continue;
        power.spawn = { ...power.spawn, name: called };
      }
      who.ability = power;
      return who;
    }
  }
  return who;
}

/**
 * What the explorer wore and could reach for when the fight opened. A fight is
 * read long after it happened, and should read as it stood.
 */
export function standingIn(campaign: CampaignT, skill: string) {
  const vitals = (campaign.vitals || {}) as any;
  return {
    fatigue: vitals.fatigue ?? 0,
    hunger: vitals.hunger ?? 0,
    worn: canon.holdings(EXPLORER).filter((h) => h.worn).map((h) => ({
      id: h.item, name: h.name, slot: h.slot, type: h.type,
      rarity: h.rarity, does: canon.does(h.effects),
    })),
  };
}

/**
 * A fight the game master has just declared, or the one it walked away from and
 * has now walked back into. Everybody on both sides, in the order they act.
 */
export function openFight(campaign: CampaignT, draft: Record<string, any>): Fight {
  let said = (draft.fight || {}) as Record<string, any>;
  const held = (campaign.fight || {}) as Record<string, any>;
  if (!Object.keys(said).length && Object.keys(held).length) said = held;
  let them = said.them as any[] | undefined;
  if (!them) them = said.name || said.health ? [said] : [];
  const [weapon, hurt] = swungWith(campaign);
  const vitals = (campaign.vitals || {}) as any;
  const skill = String(said.skill || "athletics").toLowerCase();

  const me: Fighter = {
    id: EXPLORER,
    name: explorerName(campaign),
    kind: "explorer",
    health: vitals.health ?? MAX_HEALTH,
    most: MAX_HEALTH,
    opened: vitals.health ?? MAX_HEALTH,
    damage: hurt,
    weapon,
    dc: Math.trunc(Number(said.their_dc) || 11),
    bonus: sheet.skillBonus(campaign, skill) || 0,
    defense: wornDefense(),
    skill,
    ability: null,
    asleep: 0,
    dead: false,
    ...standingIn(campaign, skill),
  };

  const fight: Fight = {
    skill,
    flee_dc: Math.trunc(Number(said.flee_dc) || 10),
    us: [me, ...(said.us || []).map((x: any) => fighter(x, "ally"))],
    them: them.map((x: any) => fighter(x, "foe")),
    turn: 0,
    round: 1,
    ended: null,
    blows: [],
    owed: [],
    said: String(draft.narration || "").trim(),
  };
  for (const foe of fight.them) borne(foe, campaign);
  fight.name = fight.them.length ? fight.them[0].name : "it";
  return fight;
}

/**
 * Everybody in the fight, in the order they act — our side then theirs, and
 * anything that arrives partway through falls in at the back.
 */
export const order = (fight: Fight): Fighter[] => [...fight.us, ...fight.them];

export const standing = (fight: Fight) => order(fight).filter((x) => !x.dead);

/**
 * Whose turn it is, skipping the fallen. The pointer walks a fixed list rather
 * than a shrinking one, so a death never hands anybody a second swing.
 */
export function whoseTurn(fight: Fight): Fighter | null {
  const line = order(fight);
  if (!line.length || line.every((x) => x.dead)) return null;
  for (let step = 0; step <= line.length; step++) {
    const at = fight.turn + step;
    if (at >= line.length) {
      fight.turn = 0;
      fight.round += 1;
      return whoseTurn(fight);
    }
    if (!line[at].dead) {
      fight.turn = at;
      return line[at];
    }
  }
  return null;
}

/**
 * Who this one swings at — the other side, weakest first, so a fight closes
 * rather than spreading thin.
 */
export function marks(fight: Fight, who: Fighter): Fighter | null {
  const side = who.kind !== "foe" ? fight.them : fight.us;
  const up = side.filter((x: Fighter) => !x.dead);
  if (!up.length) return null;
  return up.reduce((a: Fighter, b: Fighter) => (b.health < a.health ? b : a));
}

/**
 * The body a stored choice names, found again in the fight as it stands. What the
 * explorer picked is written to disk between the asking and the swing, so keeping
 * hold of the body itself swings at a copy and throws the wound away.
 */
export function stillUp(fight: Fight, want: unknown): Fighter | null {
  const id = want && typeof want === "object" ? (want as any).id : want;
  if (!id) return null;
  return fight.them.find((x: Fighter) => x.id === id && !x.dead) ?? null;
}

export const usable = (campaign: CampaignT) =>
  canon.holdings(EXPLORER).filter((h) => h.type === "consumable" && Math.trunc(Number(h.qty) || 0) > 0);

/**
 * Whether what it can do is there to be done. A thing used once is done with;
 * anything else waits out its cooldown.
 */
export function ready(who: Fighter): boolean {
  const power = who.ability;
  if (!power) return false;
  if (power.spawn) return !power.used;
  return Math.trunc(Number(who.cool) || 0) <= 0;
}

/** An ability that puts bodies on the field — one, or a street's worth. */
export function spawn(fight: Fight, who: Fighter | null, rng: Rng, said?: any): Fighter[] {
  const want = said || who!.ability.spawn;
  const come: Fighter[] = [];
  for (let n = 0; n < Math.max(1, Math.trunc(Number(want.count) || 1)); n++) {
    const born = fighter(want, "foe");
    const same = fight.them.filter((x: Fighter) => x.name.split(" #")[0] === born.name).length;
    if (same) {
      born.id = `${born.id}-${same + 1}`;
      born.name = `${born.name} #${same + 1}`;
    }
    fight.them.push(born);
    come.push(born);
  }
  return come;
}

/**
 * What armour is worth. It does not subtract from a blow, it divides it — so a
 * great deal of defense is a great deal of good and is never quite enough.
 */
export function soften(hurt: number, guard: unknown): number {
  const kept = DEFENSE_HALVES / (DEFENSE_HALVES + Math.max(0, Math.trunc(Number(guard) || 0)));
  // Python rounds half to even; a blow is small enough that the difference shows.
  const scaled = hurt * kept;
  const floor = Math.floor(scaled);
  const rest = scaled - floor;
  const rounded =
    rest > 0.5 ? floor + 1 : rest < 0.5 ? floor : floor % 2 === 0 ? floor : floor + 1;
  return Math.max(1, rounded);
}

export function wound(fight: Fight, mark: Fighter, hurt: number, blow: Blow) {
  if (!hurt) return;
  const raw = hurt;
  const taken = soften(hurt, mark.defense);
  if (raw !== taken) blow.blocked = raw - taken;
  mark.health = Math.max(0, mark.health - taken);
  if (mark.health <= 0) mark.dead = true;
  if (blow.side === "us") blow.dealt = taken;
  else blow.taken = taken;
  blow.left = mark.health;
}

export function settle(fight: Fight) {
  if (fight.ended) return;
  if (fight.us[0].dead) fight.ended = "killed";
  else if (fight.them.every((x: Fighter) => x.dead)) fight.ended = "beaten";
}

/** Anything called for in an earlier round turns up when its round comes. */
export function arrive(fight: Fight, rng: Rng) {
  const owed: any[] = [];
  const waiting: any[] = [];
  for (const due of fight.owed || []) (due.at <= fight.round ? owed : waiting).push(due);
  for (const due of owed) {
    const come = spawn(fight, null, rng, due.spawn);
    fight.blows.push({
      n: fight.blows.length + 1, round: fight.round, who: "the-world",
      name: come.map((x) => x.name).join(", "), side: "them",
      chose: `answers ${due.by}`, hit: false, dealt: 0, taken: 0,
      check: null, text: "", arrived: true,
      us: snapshot(fight.us), them: snapshot(fight.them),
    });
  }
  fight.owed = waiting;
}

/** Health of every body the instant after a blow, for the bars to animate from. */
export const snapshot = (side: Fighter[]) =>
  side.map((x) => ({ id: x.id, health: x.health, dead: x.dead }));

const MENDED: Record<string, RegExp> = {
  health: /([+\-−]?\d+)\s*health/,
  hunger: /([+\-−]?\d+)\s*hunger/,
};

/**
 * What a thing used mid-fight moved. The bands are written the way the world
 * writes them, minus signs and all.
 */
export function mended(blow: Blow, stat: string): number {
  const found = MENDED[stat].exec(String(blow.mended ?? ""));
  if (!found) return 0;
  return Math.trunc(Number(found[1].replace("−", "-")) || 0);
}

export const ENDED_STATES = ["beaten", "killed", "fled", "broken"];
