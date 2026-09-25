import * as canon from "../canon.ts";
import * as fight from "../fight.ts";
import * as prompts from "../prompts.ts";
import * as sheet from "../sheet.ts";
import { random, type Rng } from "../rng.ts";
import {
  Blow, type BlowT, type CampaignT, type CheckT, type FightT, type FighterT, type SwingT,
} from "../schema.ts";
import { MAX_BLOWS, SKILL_DIE } from "../config.ts";
import { rollAgainst, rollCheck } from "./dice.ts";
import { askExplorer, firstUtterance } from "./explorer.ts";
import { hold, holdForLore, listed, readRecord, ruleRecord, sendBack } from "./lore.ts";
import { fightOf, type Step, type World } from "./turn.ts";

/**
 * The whole of the lore master's part in a fight. Everything it puts on the ground
 * is ruled on once, here, before a die is thrown — after this the fight belongs to
 * the game master and nobody checks a blow.
 */
export const stepMuster: Step<"muster"> = async (world) => {
  const { campaign, turn } = world;
  const running = fightOf(turn);
  const strangers = fight.unbound(running).map((x) => ({ id: x.id, name: x.name }));
  const said = running.said;
  const facts = await readRecord(world, said, prompts.muster(running));
  const [claims, verdicts, ruled] = await ruleRecord(
    world, said, facts, strangers.length ? strangers : null
  );

  const asked: string[] = [];
  for (const bound of ruled.bodies) {
    const declared = canon.slug(bound.declared);
    const became = canon.slug(bound.is);
    if (became && canon.called(became) && fight.rebind(running, declared, became, campaign)) continue;
    const was = strangers.find((x) => x.id === declared)?.name || declared;
    asked.push(bound.question?.trim() || `does ${was} exist, and what is it`);
  }
  for (const stray of fight.unbound(running)) {
    if (!strangers.some((x) => x.id === stray.id)) continue;
    if (!asked.some((q) => q.includes(stray.name) || q.includes(stray.id))) {
      asked.push(`does ${stray.name} exist, and what is it`);
    }
  }
  if (asked.length) return hold(world, listed(asked));

  const unresolved = verdicts.filter((v) => v.result === "UNRESOLVED");
  if (unresolved.length) return holdForLore(world, claims, unresolved);

  const wrong = verdicts.filter((v) => v.result === "FALSE");
  if (wrong.length) {
    const edge = sendBack(
      world, wrong, "The game master could not declare a fight that survives adjudication.", "rejected"
    );
    if (edge === "rejected") {
      turn.phases = turn.phases.filter((x) => x.kind !== "fight" || x.status === "checked");
    }
    return edge;
  }

  turn.correction = null;
  return "mustered";
};

/**
 * One word back from the explorer, read the way an action is read. Anything that
 * does not parse is a swing, because a body in a fight does not stand still.
 */
function chosenBlow(
  said: string, campaign: CampaignT, running?: FightT | null, spent: string[] = []
): SwingT {
  const first = String(said ?? "").trim().split("\n");
  const head = (first[0] || "").trim().replace(/^["'`*]+|["'`*]+$/g, "").trim();
  const upper = head.toUpperCase();
  if (upper.startsWith("FLEE")) return { verb: "FLEE" };
  if (upper.startsWith("ITEM")) {
    const want = canon.slug(head.slice(4));
    const found = fight.usable(spent).find((h) => canon.slug(h.name) === want);
    return found ? { verb: "ITEM", item: found.item } : { verb: "ATTACK" };
  }
  if (upper.startsWith("SKILL")) {
    const name = head.slice(5).split(/\s+/).filter(Boolean).join(" ").toLowerCase().replace(/^[:\- ]+|[:\- ]+$/g, "");
    if (sheet.skillBonus(campaign, name) !== null) {
      return { verb: "SKILL", skill: name, mark: aimed(head, running) };
    }
  }
  return { verb: "ATTACK", mark: aimed(head, running) };
}

/**
 * `ATTACK the rat mother` picks its mark, and picks it by id. Naming nobody leaves
 * the choosing to the driver, which goes for whoever is closest to dropping.
 */
function aimed(head: string, running?: FightT | null): string | null {
  if (!running) return null;
  const rest = head.split(/\s+/).slice(1).join(" ");
  const want = canon.slug(rest);
  if (!want) return null;
  const found = running.them.find(
    (x) => !x.dead && (x.id === want || canon.slug(x.name) === want)
  );
  return found ? found.id : null;
}

/** Ask them what they do with this turn of theirs. One line out, one word back. */
export const stepSwing: Step<"swing"> = async ({ campaign, turn }) => {
  const running = fightOf(turn);
  const me = running.us[0];
  const first = !running.blows.length;
  const message = first
    ? prompts.fightOpen(running, me, fight.usable(turn.spent))
    : prompts.fightBlow(running, me, prompts.saidBlow(running.blows[running.blows.length - 1]));
  const text = await askExplorer(campaign, message);
  turn.swing = chosenBlow(firstUtterance(text) || text, campaign, running, turn.spent);
  return "chose";
};

/** The explorer's turn, spent the way they said to spend it. */
function takeTurn(
  world: World, running: FightT, me: FighterT, blow: BlowT, rng: Rng
) {
  const picked: SwingT = world.turn.swing ?? { verb: "ATTACK" };
  blow.chose = picked.verb;

  if (picked.verb === "ITEM") {
    const used = fight.usable(world.turn.spent).find((h) => h.item === picked.item);
    if (used) {
      blow.chose = `ITEM ${used.name}`;
      blow.mended = canon.does(used.effects);
      world.turn.spent.push(used.name);
      me.health = Math.min(me.most, me.health + fight.mended(blow, "health"));
      blow.left = me.health;
      return;
    }
    blow.chose = "ATTACK";
  }

  if (picked.verb === "FLEE") {
    const [check] = strike(world.campaign, me, me.skill ?? null, running.flee_dc, rng);
    blow.check = check;
    blow.hit = check.passed;
    if (check.passed) running.ended = "fled";
    return;
  }

  const skill = picked.verb === "SKILL" ? picked.skill : me.skill ?? null;
  if (picked.verb === "SKILL") blow.chose = `SKILL ${picked.skill}`;
  const mark = fight.stillUp(running, "mark" in picked ? picked.mark : null) || fight.marks(running, me);
  if (!mark) return;
  const [check, hurt] = strike(world.campaign, me, skill, mark.dc, rng);
  blow.check = check;
  blow.hit = check.passed;
  blow.at = mark.id;
  blow.atname = mark.name;
  fight.wound(running, mark, hurt, blow);
}

/**
 * One swing. The driver rolls; nobody argues with it. `edge` throws two dice and
 * keeps the better, which is the one thing a body can have going for it.
 */
function strike(
  campaign: CampaignT | null, who: FighterT, skill: string | null, dc: number, rng: Rng,
  edge = false, hurts?: string | null
): [CheckT, number] {
  const rolled = who.kind === "explorer" && campaign ? rollCheck(campaign, { skill: skill ?? "", dc }, rng) : null;
  const check = rolled ?? rollAgainst(skill || "a swing", dc, who.bonus, rng, [], edge);
  const bandOf = hurts || who.damage;
  let hurt = 0;
  if (check.passed) {
    hurt = fight.band(bandOf, rng);
    if (check.roll === SKILL_DIE) hurt += fight.band(bandOf, rng);
  }
  return [check, hurt];
}

/** Whoever's turn it is takes it. The explorer is asked; everybody else is rolled. */
export const stepFight: Step<"fight"> = async (world, rng = random) => {
  const { turn } = world;
  const running = fightOf(turn);
  const who = fight.whoseTurn(running);
  if (who === null) {
    running.ended = running.ended || "beaten";
    return "over";
  }

  if (who.kind === "explorer" && turn.swing == null) return "theirs";

  const blow = Blow.parse({
    n: running.blows.length + 1,
    round: running.round,
    who: who.id,
    name: who.name,
    side: who.kind !== "foe" ? "us" : "them",
    chose: "ATTACK",
    hit: false,
    dealt: 0,
    taken: 0,
    check: null,
    text: "",
  });

  if (who.asleep > 0) {
    who.asleep -= 1;
    blow.chose = "ASLEEP";
    blow.spent = true;
  } else if (who.kind === "explorer") {
    takeTurn(world, running, who, blow, rng);
  } else if (fight.ready(who) && who.ability?.spawn) {
    const power = who.ability;
    const called = who.ability.spawn;
    const wait = Math.trunc(Number(power.delay) || 0);
    blow.chose = String(power.name || "spawns");
    if (wait) {
      running.owed.push({ at: running.round + wait, spawn: called, by: who.name });
      blow.calling = `${called.name} x${called.count || 1}`;
    } else {
      blow.spawned = fight.spawn(running, called).map((x) => x.name).join(", ");
    }
    who.asleep = Math.trunc(Number(power.sleep) || 0);
    who.cool = Math.trunc(Number(power.cooldown) || 0);
    power.used = true;
  } else {
    who.cool = Math.max(0, Math.trunc(Number(who.cool) || 0) - 1);
    const power = fight.ready(who) && who.ability ? who.ability : null;
    const mark = fight.marks(running, who);
    if (mark) {
      const [check, hurt] = strike(
        null, who, who.skill ?? null, mark.dc, rng, !!power?.advantage, power?.damage
      );
      blow.check = check;
      blow.hit = check.passed;
      blow.at = mark.id;
      blow.atname = mark.name;
      if (power) {
        blow.chose = String(power.name || "its best");
        who.cool = Math.trunc(Number(power.cooldown) || 0);
        who.asleep = Math.trunc(Number(power.sleep) || 0);
      }
      fight.wound(running, mark, hurt, blow);
    }
  }

  running.blows.push(blow);
  blow.us = fight.snapshot(running.us);
  blow.them = fight.snapshot(running.them);
  turn.swing = null;

  fight.settle(running);
  if (!running.ended && running.blows.length >= MAX_BLOWS) running.ended = "broken";
  if (running.ended) return "over";
  fight.pass(running);
  return "next";
};
