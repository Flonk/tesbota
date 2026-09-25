/** The adventurer's own body and kit: what they can take, what they can lift. */

import * as canon from "./canon.ts";
import * as view from "./view.ts";
import * as worldclock from "./worldclock.ts";
import {
  ABILITIES, CARRY_PER_STR, EXPLORER, MAX_FATIGUE, MAX_HEALTH, MAX_HUNGER,
  OVER_DRAG, SKILL_ABILITY,
} from "./config.ts";
import { explorerName, loadCampaign } from "./state.ts";
import type { CampaignT } from "./schema.ts";

const HEALTH_WORDS: Array<[number, string]> = [
  [90, "unhurt"], [70, "bruised"], [45, "hurt"], [20, "badly hurt"], [0, "failing"],
];
const FATIGUE_WORDS: Array<[number, string]> = [
  [0, "rested"], [25, "warm"], [50, "tiring"], [75, "weary"], [90, "spent"],
];
const HUNGER_WORDS: Array<[number, string]> = [
  [0, "fed"], [25, "peckish"], [50, "hungry"], [75, "very hungry"], [90, "starving"],
];

export function descend(value: number, table: Array<[number, string]>): string {
  for (const [threshold, word] of table) if (value >= threshold) return word;
  return table[table.length - 1][1];
}

export function ascend(value: number, table: Array<[number, string]>): string {
  let word = table[0][1];
  for (const [threshold, name] of table) if (value >= threshold) word = name;
  return word;
}

export function renderQuestLog(campaign?: CampaignT | null): string {
  const c = campaign ?? loadCampaign();
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

export const modifier = (score: unknown) => Math.floor((Number(score) - 10) / 2);

/**
 * The plains reckon weight in stone, and a number nobody would say aloud reads
 * worse than a rounded one.
 */
export const stone = (weight: unknown) => String(Number((Number(weight) || 0).toFixed(1)));

/** What their back can take, in stone. Strength and nothing else decides it. */
export function capacity(campaign?: CampaignT | null): number {
  const c = campaign ?? loadCampaign();
  return Number((Math.trunc(Number(c.skills.abilities.str ?? 10)) * CARRY_PER_STR).toFixed(1));
}

/**
 * What they have on them. A promise weighs nothing, being a thing they owe rather
 * than a thing they hold.
 */
export function carried(entries?: canon.Holding[] | null): number {
  let total = 0;
  for (const e of entries ?? canon.holdings(EXPLORER)) {
    const qty = Math.trunc(Number(e.qty) || 1);
    if (qty > 0) total += (Number(e.weight) || 0) * qty;
  }
  return Number(total.toFixed(2));
}

export type Load = ReturnType<typeof load>;

export function load(campaign?: CampaignT | null) {
  const weight = carried();
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

export function renderStats(campaign?: CampaignT | null): string {
  const c = campaign ?? loadCampaign();
  const { health, fatigue, hunger } = c.vitals;
  const heavy = load(c);

  const lines = [
    explorerName(c),
    "",
    `health    ${pad(health, 3)} / ${MAX_HEALTH}   ${descend(health, HEALTH_WORDS)}`,
    `fatigue   ${pad(fatigue, 3)} / ${MAX_FATIGUE}   ${ascend(fatigue, FATIGUE_WORDS)}`,
    `hunger    ${pad(hunger, 3)} / ${MAX_HUNGER}   ${ascend(hunger, HUNGER_WORDS)}`,
    `load      ${pad(stone(carried()), 3)} / ${stone(capacity(c))} stone` +
      (heavy.over ? `   overloaded — the road takes ${heavy.drag}x as long` : ""),
    "",
    "skills",
  ];

  const { abilities, proficient, proficiency } = c.skills;
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
    const ability = SKILL_ABILITY[name];
    const trained = proficient.includes(name);
    const total = modifier(abilities[ability] ?? 10) + (trained ? proficiency : 0);
    lines.push(`  ${trained ? "*" : " "} ${padEnd(name, 16)} ${ability}  ${signed(total)}`);
  }
  lines.push("", "  * trained");
  return lines.join("\n");
}

export type Item = {
  name: string; qty: number; about: string; weight?: number | null; does: string; worn: boolean;
};

export function asItem(entry: canon.Holding | string): Item {
  if (typeof entry === "object" && entry !== null) {
    return {
      name: entry.name ?? "something",
      qty: Math.trunc(Number(entry.qty) || 1),
      about: entry.about || "",
      weight: entry.weight,
      does: canon.does(entry.effects),
      worn: !!entry.worn,
    };
  }
  return { name: String(entry), qty: 1, about: "", does: "", worn: false };
}

export const items = (): Item[] => canon.holdings(EXPLORER).map(asItem);

export function renderInventory(): string {
  const entries = items();
  if (!entries.length) return "you are carrying nothing";

  const worn = entries.filter((e) => e.worn);
  const stowed = entries.filter((e) => !e.worn);

  const line = (e: Item) => {
    const count = e.qty > 1 ? ` x${e.qty}` : "";
    const does = e.does ? ` — ${e.does}` : "";
    const heft = e.weight ? ` [${stone(e.weight)} st]` : "";
    const said = [`  ${e.name}${count}${does}${heft}`];
    if (e.about) said.push(view.wrap(canon.plain(e.about), 70, "      "));
    return said.join("\n");
  };

  const heavy = load();
  const out = [
    `carrying ${stone(carried(canon.holdings(EXPLORER)))} of ${stone(capacity())} stone` +
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
