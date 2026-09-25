import { z } from "zod";
import * as canon from "../canon.ts";
import * as prompts from "../prompts.ts";
import * as worldclock from "../worldclock.ts";
import { ask, extractJson } from "../agent.ts";
import {
  Claim, Listed, Verdict, Written,
  type CampaignT, type ClaimT, type DraftT, type TurnT, type VerdictT,
} from "../schema.ts";
import { DIE, MAX_FATIGUE, MAX_GM_RETRIES } from "../config.ts";
import { rollCheck, rollFate } from "./dice.ts";
import { standingIn } from "./deliver.ts";
import { drafted, openPhase, type Step, type World } from "./turn.ts";

const Facts = z.object({ facts: Listed(z.coerce.string()) });

const Ruled = z.object({
  claims: Listed(Written),
  bodies: Listed(z.object({
    declared: z.string().nullish(), is: z.string().nullish(), question: z.string().nullish(),
  })),
});

function derived(ruled: Record<string, unknown>[]): [ClaimT[], VerdictT[]] {
  const claims: ClaimT[] = [];
  const verdicts: VerdictT[] = [];
  for (const entry of ruled) {
    const id = String(entry.id || `c${claims.length + 1}`);
    claims.push(Claim.parse({ id, text: String(entry.text || ""), entity: entry.entity ?? null, kind: entry.kind ?? null }));
    verdicts.push(Verdict.parse({
      claim: id,
      result: entry.result,
      why: entry.why || "",
      question: entry.question || "",
      alternative: entry.alternative || "",
      sources: entry.sources || [],
    }));
  }
  return [claims, verdicts];
}

/**
 * Lore 1: what the narration asserts about the world. It is handed the words and
 * nothing else — no canon, no tools — so it cannot quietly frame a fact to fit
 * what the record already holds.
 */
export async function readRecord(
  { campaign, turn }: World, narration: string, roster?: string | null
): Promise<string[]> {
  const [read] = await ask(
    "lore1",
    prompts.lore1Turn(narration, {
      where: campaign.location_path,
      now: worldclock.longStamp(campaign.time),
      roster: roster ?? null,
      // The structured half of the draft goes the same way the prose does.
      did: prompts.doings(turn.draft, standingIn(campaign)) || null,
    })
  );
  const facts = extractJson(read, Facts).facts.map((f) => f.trim()).filter(Boolean);
  turn.facts = facts;
  return facts;
}

/**
 * Lore 2: the ruling. The only layer that reads canon, which is what splitting the
 * reading from the ruling was for.
 */
export async function ruleRecord(
  { campaign, turn }: World, narration: string, facts: string[],
  unknown?: Array<{ id: string; name: string }> | null
): Promise<[ClaimT[], VerdictT[], z.output<typeof Ruled>]> {
  const [text] = await ask("lore2", prompts.lore2Turn(narration, facts, unknown));
  const ruled = extractJson(text, Ruled);
  const [claims, verdicts] = derived(ruled.claims);
  drafted(turn).claims = claims;

  const settled = new Set(campaign.settled.map((t) => canon.plain(t)));
  for (const verdict of verdicts) {
    const claim = claims.find((c) => c.id === verdict.claim);
    if (claim && settled.has(canon.plain(claim.text))) {
      verdict.result = "WITHIN_BOUNDS";
      verdict.why = "already ruled on";
    }
  }
  turn.verdicts = verdicts;
  return [claims, verdicts, ruled];
}

/** Nothing can go on until somebody writes the missing document. */
export function hold({ campaign, turn }: World, gap: string): "unwritten" {
  turn.gap = gap;
  const blocked = openPhase(turn);
  if (blocked) blocked.status = "blocked";
  campaign.quiet = 0;
  return "unwritten";
}

export const listed = (lines: string[]) => lines.map((line) => "- " + line).join("\n");

export function holdForLore(world: World, claims: ClaimT[], unresolved: VerdictT[]): "unwritten" {
  const byId = new Map(claims.map((c) => [c.id, c]));
  return hold(world, listed(unresolved.map((v) => v.question.trim() || byId.get(v.claim)?.text || v.claim)));
}

export function sendBack<E extends string>(world: World, wrong: VerdictT[], failed: string, edge: E): E | "unwritten" {
  const { turn } = world;
  if (turn.gm_retries >= MAX_GM_RETRIES) {
    return hold(world, `${failed}\n\n${JSON.stringify({ false: wrong }, null, 2)}`);
  }
  turn.gm_retries += 1;
  turn.correction = JSON.stringify({ contradicts_the_record: wrong }, null, 2);
  return edge;
}

const FATE_INSTRUCTIONS: Record<string, string> = {
  greater_calamity:
    "The dice have gone hard against them. Renarrate this same action, but " +
    "something goes badly and lastingly wrong in the doing of it — a real injury, " +
    "something lost or broken beyond mending, something dangerous arriving. Do not " +
    "soften it and do not undo the action.",
  lesser_calamity:
    "The dice have gone against them. Renarrate this same action, but it goes " +
    "wrong in a small way — a setback, a fumble, time or effort spent for nothing, " +
    "a minor hurt. It should sting, not maim. Do not undo the action.",
  lesser_fortune:
    "The dice have favoured them a little. Renarrate this same action, but " +
    "something small goes better than it had any right to — a thing noticed that " +
    "would have been missed, an easier way, a stroke of ordinary luck.",
  greater_fortune:
    "The dice have favoured them greatly. Renarrate this same action, but " +
    "something genuinely lucky happens in the doing of it — a real find, an " +
    "unlooked-for kindness, a danger that passes them by entirely. Let it matter.",
};

/**
 * Mid-fight this is nonsense — nobody stops swinging to be told they are weary —
 * so a draft carrying a fight is never sent back for it.
 */
function tooTired(campaign: CampaignT, draft: DraftT): boolean {
  if (draft.fight) return false;
  return campaign.vitals.fatigue + draft.fatigue > MAX_FATIGUE;
}

/**
 * Where a rejected draft goes back to: an answer to be answered again, anything
 * else to the game master. A rolled fight never comes here — it was checked at its
 * muster, and its dice are not the lore master's to overturn.
 */
const redraftEdge = (turn: TurnT) => (turn.asking ? "reanswer" : "redraft");

/** Lore 1 alone: read the world out of it, then hand the facts to the ruling. */
export const stepLore1: Step<"lore1"> = async (world) => {
  await readRecord(world, drafted(world.turn).narration);
  return "read";
};

/** Lore 2 alone: rule on what lore 1 read, and decide where the draft goes. */
export const stepLore2: Step<"lore2"> = async (world) => {
  const { campaign, turn } = world;
  const draft = drafted(turn);
  const narration = draft.narration;
  const [claims, verdicts] = await ruleRecord(world, narration, turn.facts);

  const wrong = verdicts.filter((v) => v.result === "FALSE");
  const unresolved = verdicts.filter((v) => v.result === "UNRESOLVED");

  if (unresolved.length) return holdForLore(world, claims, unresolved);

  if (tooTired(campaign, draft) && !turn.fate && turn.gm_retries < MAX_GM_RETRIES) {
    turn.gm_retries += 1;
    turn.correction = JSON.stringify({
      too_tired: {
        fatigue_now: campaign.vitals.fatigue,
        this_action_would_add: draft.fatigue,
        maximum: MAX_FATIGUE,
      },
      instruction:
        "They are too worn out to do this. Do not narrate them doing it. " +
        "Narrate that they cannot, and what resting here would take.",
    }, null, 2);
    return redraftEdge(turn);
  }

  if (!wrong.length && turn.roll == null && !turn.asking) {
    const check = rollCheck(campaign, draft.check);
    turn.check = check;
    const fate = rollFate(turn);
    const payload: Record<string, unknown> = {};

    if (check && !check.passed) {
      payload.failed_check = check;
      payload.check_instruction =
        `They tried and fell short: a ${check.skill} check, rolled ` +
        `${check.roll} plus ${check.bonus >= 0 ? "+" : ""}${check.bonus} against a difficulty of ` +
        `${check.dc}` +
        (check.against.length
          ? `, worst of ${check.rolls.length} because they are ${check.against.join(" and ")}`
          : "") +
        ". Renarrate the same attempt not working. They may try " +
        "something else afterwards, but this attempt failed.";
    } else if (check) {
      payload.passed_check = check;
    }

    if (fate) {
      payload.fate = fate;
      payload.rolled = turn.roll;
      payload.die = DIE;
      payload.fate_instruction = FATE_INSTRUCTIONS[fate];
    }

    if ("failed_check" in payload || fate) {
      turn.correction = JSON.stringify(payload, null, 2);
      return redraftEdge(turn);
    }
  }

  if (wrong.length) {
    return sendBack(
      world, wrong, "The game master could not produce a draft that survives adjudication.", redraftEdge(turn)
    );
  }
  return "stands";
};
