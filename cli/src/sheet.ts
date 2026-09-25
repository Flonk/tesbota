/** The adventurer's own body and kit: what they can take, what they can lift. */

import * as canon from "./canon.ts";
import * as view from "./view.ts";
import * as worldclock from "./worldclock.ts";
import {
  ABILITIES, CARRY_PER_STR, EXPLORER, MAX_FATIGUE, MAX_HEALTH, MAX_HUNGER,
  OVER_DRAG, SKILL_ABILITY,
} from "./config.ts";
import { explorerName } from "./state.ts";
import type { CampaignT } from "./schema.ts";

const HEALTH_WORDS: Array<[number, string]> = [
  [0, "failing"], [20, "badly hurt"], [45, "hurt"], [70, "bruised"], [90, "unhurt"],
];
const FATIGUE_WORDS: Array<[number, string]> = [
  [0, "rested"], [25, "warm"], [50, "tiring"], [75, "weary"], [90, "spent"],
];
const HUNGER_WORDS: Array<[number, string]> = [
  [0, "fed"], [25, "peckish"], [50, "hungry"], [75, "very hungry"], [90, "starving"],
];

function wordFor(value: number, table: Array<[number, string]>): string {
  let word = table[0][1];
  for (const [threshold, name] of table) if (value >= threshold) word = name;
  return word;
}

export function renderQuestLog(c: CampaignT): string {
  const quests = c.quests;
  if (!quests.length) return "you have taken nothing on";

  const active = quests.filter((q) => q.status === "active");
  const past = quests.filter((q) => q.status !== "active");

  const out: string[] = [];
  if (active.length) {
    out.push("ongoing:");
    for (const q of active) {
      const giver = q.giver ? `  (${q.giver})` : "";
      out.push(`  ${q.title}${giver}  [${worldclock.shorten(q.at)}]`);
      if (q.detail) out.push(`      ${q.detail}`);
    }
  }
  if (past.length) {
    if (out.length) out.push("");
    out.push("finished:");
    for (const q of past) {
      out.push(`  ${q.title} — ${q.status}  [${worldclock.shorten(q.closed_at)}]`);
    }
  }
  return out.join("\n");
}

const modifier = (score: unknown) => Math.floor((Number(score) - 10) / 2);

/**
 * The plains reckon weight in stone, and a number nobody would say aloud reads
 * worse than a rounded one.
 */
const stone = (weight: unknown) => String(Number((Number(weight) || 0).toFixed(1)));

/** What their back can take, in stone. Strength and nothing else decides it. */
function capacity(c: CampaignT): number {
  return Number((Math.trunc(Number(c.skills.abilities.str ?? 10)) * CARRY_PER_STR).toFixed(1));
}

/**
 * What they have on them. A promise weighs nothing, being a thing they owe rather
 * than a thing they hold.
 */
function carried(entries: canon.Holding[]): number {
  let total = 0;
  for (const e of entries) {
    const qty = Math.trunc(Number(e.qty) || 1);
    if (qty > 0) total += (Number(e.weight) || 0) * qty;
  }
  return Number(total.toFixed(2));
}

export type Load = ReturnType<typeof load>;

export function load(campaign: CampaignT, held = canon.holdings(EXPLORER)) {
  const weight = carried(held);
  const most = capacity(campaign);
  const over = weight > most;
  return {
    carried: weight,
    capacity: most,
    over,
    drag: over && most ? Number((1 + (OVER_DRAG * (weight - most)) / most).toFixed(2)) : 1.0,
  };
}

export function skillBonus(campaign: CampaignT, skill: string): number | null {
  const { abilities, proficient, proficiency } = campaign.skills;
  const ability = SKILL_ABILITY[skill];
  if (ability === undefined) return null;
  let total = modifier(abilities[ability] ?? 10);
  if (proficient.includes(skill)) total += proficiency;
  return total;
}

const pad = (s: string | number, n: number) => String(s).padStart(n);
const padEnd = (s: string | number, n: number) => String(s).padEnd(n);
const signed = (n: number) => `${n >= 0 ? "+" : ""}${n}`;

export function renderStats(c: CampaignT): string {
  const { health, fatigue, hunger } = c.vitals;
  const heavy = load(c);

  const lines = [
    explorerName(c),
    "",
    `health    ${pad(health, 3)} / ${MAX_HEALTH}   ${wordFor(health, HEALTH_WORDS)}`,
    `fatigue   ${pad(fatigue, 3)} / ${MAX_FATIGUE}   ${wordFor(fatigue, FATIGUE_WORDS)}`,
    `hunger    ${pad(hunger, 3)} / ${MAX_HUNGER}   ${wordFor(hunger, HUNGER_WORDS)}`,
    `load      ${pad(stone(heavy.carried), 3)} / ${stone(heavy.capacity)} stone` +
      (heavy.over ? `   overloaded — the road takes ${heavy.drag}x as long` : ""),
    "",
    "skills",
  ];

  const { abilities, proficient } = c.skills;
  if (!Object.keys(abilities).length) {
    lines.push("  you have not found out what you are good at");
    return lines.join("\n");
  }

  lines[lines.length - 1] = "abilities";
  lines.push(
    "  " + ABILITIES.map((name) =>
      `${name} ${pad(abilities[name] ?? 10, 2)} (${signed(modifier(abilities[name] ?? 10))})`
    ).join("   ")
  );
  lines.push("", "skills");
  for (const name of Object.keys(SKILL_ABILITY).sort()) {
    const total = skillBonus(c, name) ?? 0;
    lines.push(`  ${proficient.includes(name) ? "*" : " "} ${padEnd(name, 16)} ${SKILL_ABILITY[name]}  ${signed(total)}`);
  }
  lines.push("", "  * trained");
  return lines.join("\n");
}

export function renderInventory(c: CampaignT): string {
  const held = canon.holdings(EXPLORER);
  if (!held.length) return "you are carrying nothing";

  const worn = held.filter((e) => e.worn);
  const stowed = held.filter((e) => !e.worn);

  const line = (e: canon.Holding) => {
    const count = e.qty > 1 ? ` x${e.qty}` : "";
    const effect = canon.does(e.effects);
    const does = effect ? ` — ${effect}` : "";
    const heft = e.weight ? ` [${stone(e.weight)} st]` : "";
    const said = [`  ${e.name}${count}${does}${heft}`];
    if (e.about) said.push(view.wrap(canon.plain(e.about), 70, "      "));
    return said.join("\n");
  };

  const heavy = load(c, held);
  const out = [
    `carrying ${stone(heavy.carried)} of ${stone(heavy.capacity)} stone` +
      (heavy.over ? ` — more than you can carry, and walking takes ${heavy.drag}x as long` : ""),
    "",
  ];
  if (worn.length) {
    out.push("worn:");
    out.push(...worn.map(line));
  }
  if (stowed.length) {
    if (out.length) out.push("");
    out.push("carried:");
    out.push(...stowed.map(line));
  }
  return out.join("\n");
}

export function renderHoldings(entity?: string | null): string {
  let holders = canon.holders();
  if (entity) {
    const want = canon.slug(entity);
    holders = holders.filter((h) => h.id === want);
    if (!holders.length) return `${want} keeps nothing`;
  }
  if (!holders.length) return "nobody keeps anything";

  const stock = Object.fromEntries(holders.map((h) => [h.id, canon.holdings(h.id)]));
  const width = Math.max(
    1, ...Object.values(stock).flatMap((its) => its.map((i) => i.name.length))
  );
  const out: string[] = [];
  for (const holder of holders) {
    if (out.length) out.push("");
    out.push(`${holder.name}  (${holder.id})`);
    for (const item of stock[holder.id]) {
      const count = item.qty > 1 ? `x${item.qty}` : "";
      out.push(`  ${padEnd(item.name, width)}  ${pad(count, 4)}`.replace(/\s+$/, ""));
    }
  }
  return out.join("\n");
}
