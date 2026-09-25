/**
 * Combat. The explorer picks each blow, the driver rolls it, and nobody argues.
 *
 * Two things are load-bearing here and were learned the hard way. A body is
 * addressed by id, never held — the turn goes to disk between the asking and the
 * swing, and a held body comes back as a copy that every wound lands on harmlessly.
 * And a fight is adjudicated once, at its muster, because a blow is a particular
 * and particulars were never the lore master's to rule on.
 */

import { z } from "zod";
import * as canon from "./canon.ts";
import * as sheet from "./sheet.ts";
import {
  DEFENSE_HALVES, EXPLORER, MAX_HEALTH, SKILL_DIE, UNARMED,
} from "./config.ts";
import { explorerName } from "./state.ts";
import type { Rng } from "./rng.ts";
import {
  Ability, Blow, Fighter, Written,
  type AbilityT, type BlowT, type CampaignT, type DraftT, type FightT, type FighterT, type SpawnT,
} from "./schema.ts";

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
export function fighter(said: Record<string, unknown>, kind: FighterT["kind"], fallbackDc = 11): FighterT {
  const ident = canon.slug(said.who || said.name || kind) || kind;
  const kept: Record<string, unknown> = canon.body(ident) ?? {};
  const written = canon.called(ident);

  const take = (field: string) => {
    const saidIt = said[field];
    if (saidIt !== undefined && saidIt !== null && saidIt !== "") return saidIt;
    const held = kept[field];
    return held === undefined || held === null || held === "" ? undefined : held;
  };

  const health = Math.trunc(Number(take("health")) || 10);
  return Fighter.parse({
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
    ability: Ability.safeParse(said.ability).data ?? null,
    asleep: 0,
    cool: 0,
    dead: false,
  });
}

/**
 * Bodies the game master named that the world has no row for. Everything else in
 * a fight is a thing already written down, and is met as what it is.
 */
export const unbound = (fight: FightT): FighterT[] =>
  [...fight.them, ...fight.us.slice(1)].filter((x) => !canon.called(x.id));

/**
 * A body the lore master matched to something already recorded. It comes back as
 * that thing, with that thing's stats, keeping whatever the game master wrote
 * over them and whatever it called it in the scene.
 */
export function rebind(fight: FightT, declared: string, bound: string): FighterT | null {
  for (const side of ["them", "us"] as const) {
    for (let at = 0; at < fight[side].length; at++) {
      const who = fight[side][at];
      if (who.id !== declared) continue;
      const said = { ...who.as_written };
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
    ...[...campaign.location_path].reverse().map((x) => x.id),
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
export function countsHere(power: AbilityT, campaign: CampaignT): boolean {
  const ground = new Set(standingOn(campaign));
  if (power.within && !ground.has(canon.slug(power.within))) return false;
  if (power.in_kind) {
    const sat = canon.findPlace(campaign.location);
    if (!sat || sat.type !== power.in_kind) return false;
  }
  const aspect = power.in_aspect;
  if (aspect && ![...ground].some((x) => canon.markedWith(x, aspect))) {
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
export function borne(who: FighterT, campaign: CampaignT): FighterT {
  const marks = canon.aspectsOf(who.id);
  who.aspects = marks.map((m) => ({ name: m.name, value: m.value, of: m.of }));
  if (who.ability) return who;
  for (const mark of marks) {
    for (const found of canon.abilitiesOf(mark.aspect)) {
      const power = Ability.safeParse({ ...found, from: mark.name }).data;
      if (!power || !countsHere(power, campaign)) continue;
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

const Bodies = z.array(Written);

/**
 * A fight the game master has just declared, or the one it walked away from and
 * has now walked back into. Everybody on both sides, in the order they act.
 */
export function openFight(campaign: CampaignT, draft: DraftT): FightT {
  let said: Record<string, unknown> = draft.fight ?? {};
  const held: Record<string, unknown> = campaign.fight ?? {};
  if (!Object.keys(said).length && Object.keys(held).length) said = held;
  const them = Bodies.safeParse(said.them).data ?? (said.name || said.health ? [said] : []);
  const [weapon, hurt] = swungWith(campaign);
  const skill = String(said.skill || "athletics").toLowerCase();

  const me = Fighter.parse({
    id: EXPLORER,
    name: explorerName(campaign),
    kind: "explorer",
    health: campaign.vitals.health,
    most: MAX_HEALTH,
    opened: campaign.vitals.health,
    damage: hurt,
    weapon,
    dc: Math.trunc(Number(said.their_dc) || 11),
    bonus: sheet.skillBonus(campaign, skill) || 0,
    defense: wornDefense(),
    skill,
    ability: null,
    asleep: 0,
    dead: false,
  });

  const foes = them.map((x) => fighter(x, "foe"));
  for (const foe of foes) borne(foe, campaign);
  return {
    skill,
    flee_dc: Math.trunc(Number(said.flee_dc) || 10),
    name: foes.length ? foes[0].name : "it",
    said: draft.narration.trim(),
    round: 1,
    turn: 0,
    ended: null,
    us: [me, ...(Bodies.safeParse(said.us).data ?? []).map((x) => fighter(x, "ally"))],
    them: foes,
    blows: [],
    owed: [],
  };
}

/**
 * Everybody in the fight, in the order they act — our side then theirs, and
 * anything that arrives partway through falls in at the back.
 */
export const order = (fight: FightT): FighterT[] => [...fight.us, ...fight.them];

export const standing = (fight: FightT) => order(fight).filter((x) => !x.dead);

/**
 * Whose turn it is, skipping the fallen. The pointer walks a fixed list rather
 * than a shrinking one, so a death never hands anybody a second swing.
 */
export function whoseTurn(fight: FightT): FighterT | null {
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
export function marks(fight: FightT, who: FighterT): FighterT | null {
  const side = who.kind !== "foe" ? fight.them : fight.us;
  const up = side.filter((x) => !x.dead);
  if (!up.length) return null;
  return up.reduce((a, b) => (b.health < a.health ? b : a));
}

/**
 * The body a stored choice names, found again in the fight as it stands. What the
 * explorer picked is written to disk between the asking and the swing, so keeping
 * hold of the body itself swings at a copy and throws the wound away.
 */
export function stillUp(fight: FightT, id: string | null | undefined): FighterT | null {
  if (!id) return null;
  return fight.them.find((x) => x.id === id && !x.dead) ?? null;
}

export const usable = (campaign: CampaignT) =>
  canon.holdings(EXPLORER).filter((h) => h.type === "consumable" && Math.trunc(Number(h.qty) || 0) > 0);

/**
 * Whether what it can do is there to be done. A thing used once is done with;
 * anything else waits out its cooldown.
 */
export function ready(who: FighterT): boolean {
  const power = who.ability;
  if (!power) return false;
  if (power.spawn) return !power.used;
  return Math.trunc(Number(who.cool) || 0) <= 0;
}

/** An ability that puts bodies on the field — one, or a street's worth. */
export function spawn(fight: FightT, want: SpawnT): FighterT[] {
  const come: FighterT[] = [];
  for (let n = 0; n < Math.max(1, Math.trunc(Number(want.count) || 1)); n++) {
    const born = fighter(want, "foe");
    const same = fight.them.filter((x) => x.name.split(" #")[0] === born.name).length;
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

export function wound(fight: FightT, mark: FighterT, hurt: number, blow: BlowT) {
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

export function settle(fight: FightT) {
  if (fight.ended) return;
  if (fight.us[0].dead) fight.ended = "killed";
  else if (fight.them.every((x) => x.dead)) fight.ended = "beaten";
}

/** Anything called for in an earlier round turns up when its round comes. */
export function arrive(fight: FightT) {
  const owed = fight.owed.filter((due) => due.at <= fight.round);
  const waiting = fight.owed.filter((due) => due.at > fight.round);
  for (const due of owed) {
    const come = spawn(fight, due.spawn);
    fight.blows.push(Blow.parse({
      n: fight.blows.length + 1, round: fight.round, who: "the-world",
      name: come.map((x) => x.name).join(", "), side: "them",
      chose: `answers ${due.by}`, hit: false, dealt: 0, taken: 0,
      check: null, text: "",
      us: snapshot(fight.us), them: snapshot(fight.them),
    }));
  }
  fight.owed = waiting;
}

/** Health of every body the instant after a blow, for the bars to animate from. */
export const snapshot = (side: FighterT[]) =>
  side.map((x) => ({ id: x.id, health: x.health, dead: x.dead }));

const MENDED: Record<string, RegExp> = {
  health: /([+\-−]?\d+)\s*health/,
  hunger: /([+\-−]?\d+)\s*hunger/,
};

/**
 * What a thing used mid-fight moved. The bands are written the way the world
 * writes them, minus signs and all.
 */
export function mended(blow: BlowT, stat: "health" | "hunger"): number {
  const found = MENDED[stat].exec(String(blow.mended ?? ""));
  if (!found) return 0;
  return Math.trunc(Number(found[1].replace("−", "-")) || 0);
}

