import * as canon from "../canon.ts";
import * as chronicle from "../chronicle.ts";
import * as prompts from "../prompts.ts";
import * as worldclock from "../worldclock.ts";
import { ask, extractJson } from "../agent.ts";
import { pendingDeath, recordDeath } from "../state.ts";
import { QuestStatus, Written, type CampaignT, type DraftT, type QuestT, type TurnT } from "../schema.ts";
import { GODHEAD_ID, HUNGER_PER_HOUR, MAX_FATIGUE, MAX_HEALTH, MAX_HUNGER } from "../config.ts";
import { drafted, fighting, onRoad, openPhase, phase, type Step } from "./turn.ts";

export function applyVitals(
  campaign: CampaignT, cost: Pick<DraftT, "minutes" | "fatigue" | "health" | "hunger">
): CampaignT {
  const vitals = campaign.vitals;
  vitals.fatigue = Math.max(0, Math.min(MAX_FATIGUE, vitals.fatigue + cost.fatigue));
  vitals.health = Math.max(0, Math.min(MAX_HEALTH, vitals.health + cost.health));

  const drift = (cost.minutes / 60) * HUNGER_PER_HOUR;
  vitals.hunger = Math.max(0, Math.min(MAX_HUNGER, Math.round(vitals.hunger + drift + (cost.hunger ?? 0))));
  return campaign;
}

export function passTime(campaign: CampaignT, minutes: number): string {
  const time = worldclock.advance(campaign.time, minutes);
  time.stamp = worldclock.stamp(time);
  time.long = worldclock.longStamp(time);
  campaign.time = time;
  return time.long;
}

export const standingIn = (campaign: CampaignT) => (campaign.position ? null : campaign.location ?? null);

/**
 * One ledger. `the-godhead` on either side is the world itself — where bread eaten
 * goes, and where a coin found in the mud comes from.
 */
function applyInventory(draft: DraftT, turnId?: string | null) {
  for (const entry of draft.transactions) {
    if (!entry.name) continue;
    const src = canon.slug(entry.from);
    const dst = canon.slug(entry.to);
    canon.transfer(
      src === "" || src === GODHEAD_ID ? null : src,
      dst === "" || dst === GODHEAD_ID ? null : dst,
      entry.name,
      entry.qty,
      turnId
    );
  }
}

const CLOSED = QuestStatus.exclude(["active"]);

/**
 * A new errand gets a shape before the game master ever plays it. Nothing here is
 * canon: it is ideation, and the walls it runs into are the point.
 */
async function scriptFor(quest: QuestT, campaign: CampaignT): Promise<string> {
  try {
    const [text] = await ask("questmaster", prompts.questmasterTurn(quest, campaign.location_path));
    return String(extractJson(text, Written).script || "").trim();
  } catch (exc) {
    return `the questmaster fell over: ${(exc as Error).name}: ${exc}`.slice(0, 400);
  }
}

async function applyQuests(campaign: CampaignT, draft: DraftT, turnId: string) {
  const quests = campaign.quests;
  const byId = new Map(quests.map((q) => [q.id, q]));

  for (const item of draft.quest_open) {
    const entry = Written.safeParse(item).data;
    const ident = canon.slug(String(entry?.id || entry?.title || ""));
    if (!entry || !ident || byId.has(ident)) continue;
    const quest: QuestT = {
      id: ident,
      at: worldclock.stamp(campaign.time),
      title: String(entry.title || ident.replace(/-/g, " ")),
      detail: String(entry.detail || ""),
      giver: String(entry.giver || ""),
      status: "active",
      opened: turnId,
      closed: null,
      where: [...campaign.location_path],
      script: "",
    };
    quest.script = await scriptFor(quest, campaign);
    quests.push(quest);
    byId.set(ident, quest);
  }

  for (const item of draft.quest_update) {
    const entry = Written.safeParse(item).data;
    if (!entry) continue;
    const quest = byId.get(canon.slug(String(entry.id || "")));
    if (!quest || quest.status !== "active") continue;
    if (entry.detail) quest.detail = String(entry.detail);
  }

  for (const item of draft.quest_close) {
    const entry = item && typeof item === "object" ? Written.safeParse(item).data ?? {} : null;
    const ident = entry ? canon.slug(String(entry.id || "")) : canon.slug(String(item));
    const outcome = entry ? String(entry.outcome || entry.status || "done").toLowerCase() : "done";
    const quest = byId.get(ident);
    if (!quest || quest.status !== "active") continue;
    quest.status = CLOSED.safeParse(outcome).data ?? "done";
    quest.closed = turnId;
    quest.closed_at = worldclock.stamp(campaign.time);
  }
  return campaign;
}

/**
 * A fight that outran the guard is carried with everybody's wounds on them. Any
 * other ending closes it, and so does a turn that leaves a carried fight out.
 * Nought health kills, which nothing in this machine did before a fight could
 * take you there.
 */
function settleFight(campaign: CampaignT, turn: TurnT): CampaignT {
  const running = fighting(turn);
  if (!running) {
    campaign.fight = null;
    return campaign;
  }
  if (running.ended === "broken") {
    campaign.fight = {
      skill: running.skill,
      flee_dc: running.flee_dc,
      name: running.name,
      us: running.us.slice(1).filter((x) => !x.dead).map((x) => ({ ...x })),
      them: running.them.filter((x) => !x.dead).map((x) => ({ ...x })),
    };
  } else {
    campaign.fight = null;
  }
  if (running.ended === "killed" && !pendingDeath()) {
    const felled = [...running.blows].reverse()
      .find((b) => b.side === "them" && b.taken)?.name || running.name;
    recordDeath(`killed by ${felled}`);
  }
  return campaign;
}

function setDown(turn: TurnT, draft: DraftT) {
  const byVerdict = new Map(turn.verdicts.map((v) => [v.claim, v]));
  let current = openPhase(turn);
  if (current === null && draft.narration) current = phase(turn, "gm", "world", draft.narration);
  if (current) {
    current.status = "checked";
    current.claims = draft.claims.map((claim) => ({
      ...claim, verdict: byVerdict.get(claim.id) ?? null,
    }));
    if (current.kind === "outcome" || current.kind === "world") {
      current.minutes = draft.minutes;
      current.fatigue = draft.fatigue;
      current.roll = turn.roll;
      current.outcomes = turn.outcomes;
      current.chosen = turn.chosen;
      current.fortune = turn.fortune;
      current.check = turn.check;
    }
  }
  turn.draft = null;
  turn.verdicts = [];
  turn.gm_retries = 0;
}

/**
 * Everything a draft changes about the world, applied in one place. Nothing before
 * it applies a draft, so a draft that never reaches here leaves no mark — which is
 * what makes a rejected draft safe to throw away.
 */
export const stepDeliver: Step<"deliver"> = async ({ campaign, turn }) => {
  const draft = drafted(turn);
  campaign.last_narration = draft.narration;

  if (turn.asking) {
    turn.asking = null;
    setDown(turn, draft);
    return "spent";
  }

  applyVitals(campaign, draft);
  applyInventory(draft, turn.turn_id);
  await applyQuests(campaign, draft, turn.turn_id);
  settleFight(campaign, turn);
  turn.at = passTime(campaign, draft.minutes);

  turn.location_path = campaign.location_path;
  turn.vitals = { ...campaign.vitals };
  const active = campaign.quests.find((q) => q.status === "active");
  turn.quest = active ? active.title : null;
  turn.destination = canon.slug(draft.destination) || standingIn(campaign);
  turn.minutes = draft.minutes;

  if (!onRoad(turn)) {
    campaign.quiet = (campaign.quiet || 0) + 1;
    campaign.calm = turn.pressed ? 0 : (campaign.calm || 0) + 1;
  }
  setDown(turn, draft);
  return "spent";
};

/** The turn is over and it survived adjudication. It is set down as it stands. */
export const stepNarrate: Step<"narrate"> = async ({ turn }) => {
  if (chronicle.played(turn)) chronicle.write(turn);
  return "written";
};
