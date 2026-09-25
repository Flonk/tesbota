import * as sheet from "../sheet.ts";
import { random, type Rng } from "../rng.ts";
import type { CampaignT, CheckT, DraftT, TurnT } from "../schema.ts";
import { DIE, SKILL_DIE } from "../config.ts";

export function rollCheck(campaign: CampaignT, asked: DraftT["check"], rng: Rng = random): CheckT | null {
  const skill = String(asked?.skill || "").trim().toLowerCase();
  const bonus = sheet.skillBonus(campaign, skill);
  if (bonus === null) return null;
  const { fatigue, hunger } = campaign.vitals;
  const against = ([["spent", fatigue], ["starving", hunger]] as const)
    .filter(([, level]) => level >= 100)
    .map(([word]) => word);
  return rollAgainst(skill, asked?.dc || 10, bonus, rng, against);
}

export function rollAgainst(
  skill: string, dc: number, bonus: number, rng: Rng, against: string[] = [], edge = false
): CheckT {
  const rolls = Array.from({ length: edge ? 2 : 1 + against.length }, () => rng.int(1, SKILL_DIE));
  const roll = edge ? Math.max(...rolls) : Math.min(...rolls);
  return {
    skill, dc, roll, rolls, against, for: edge ? ["the better of two"] : [], bonus,
    total: roll + bonus,
    passed: roll + bonus >= dc,
  };
}

export function rollFate(turn: TurnT, rng: Rng = random): string | null {
  const roll = rng.int(1, DIE);
  turn.roll = roll;
  let fate: string | null = null;
  if (roll <= 1) fate = "greater_calamity";
  else if (roll <= 2) fate = "lesser_calamity";
  else if (roll > DIE - 1) fate = "greater_fortune";
  else if (roll > DIE - 2) fate = "lesser_fortune";
  turn.fate = fate;
  return fate;
}
