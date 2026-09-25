import * as prompts from "../prompts.ts";
import { ask } from "../agent.ts";
import { spoken } from "../gate.ts";
import { pendingDeath } from "../state.ts";
import type { CampaignT, TurnT } from "../schema.ts";
import { MAX_ASKS, MAX_LOOKS, MAX_TALKS } from "../config.ts";
import { phase, type Step } from "./turn.ts";

export async function askExplorer(campaign: CampaignT, message: string): Promise<string> {
  const [text, session] = await ask("explorer", message, campaign.sessions.explorer);
  campaign.sessions.explorer = session;
  return text;
}

const ACTION_PREFIX = ["ACTION:", "DO:", "ACT:"];

/** The explorer is told the action needs no prefix and writes one anyway. */
function unprefixed(text: string | null | undefined): string {
  const bare = String(text ?? "").trim();
  for (const mark of ACTION_PREFIX) {
    if (bare.toUpperCase().startsWith(mark)) return bare.slice(mark.length).trim();
  }
  return bare;
}

export function firstUtterance(text: string | null | undefined): string {
  const kept: string[] = [];
  for (const line of String(text ?? "").trim().split("\n")) {
    const bare = line.trim();
    if (!bare) {
      if (kept.length) break;
      continue;
    }
    if (spoken(bare)[0] === "tesbota") continue;
    if (bare.toUpperCase().startsWith("LOOK:") || bare.toUpperCase().startsWith("SAY:")) {
      if (kept.length) break;
      return bare;
    }
    kept.push(bare);
  }
  return unprefixed(kept.join(" ").trim());
}

const DONE_WORDS = [
  "done", "nothing further", "nothing else", "nothing more", "that is all",
  "that's all", "thats all", "ready", "no more", "move on", "finished",
  "i'm good", "im good", "carry on", "let's go", "lets go",
];

const QUOTES = "\"'“‘„«";

const room = (turn: TurnT, kind: "look" | "say") =>
  (kind === "look" ? MAX_LOOKS : MAX_TALKS) -
  turn.phases.filter((p) => p.who === "explorer" && p.kind === kind).length;

/**
 * Work out whether an utterance is a look, a say, or the end of the turn. The
 * prefixes are honoured when given; otherwise a question is a look and speech is
 * a say, so the explorer need not remember the syntax.
 */
function classify(text: string, turn: TurnT): ["look" | "say" | "done", string] {
  const stripped = unprefixed(text);
  const upper = stripped.toUpperCase();

  if (upper.startsWith("LOOK:")) return ["look", stripped.slice(5).trim()];
  if (upper.startsWith("SAY:")) return ["say", stripped.slice(4).trim()];

  const bare = stripped.toLowerCase().replace(/^[.!… ]+|[.!… ]+$/g, "");
  if (DONE_WORDS.some((w) => bare === w || bare.startsWith(w + " ") || bare.startsWith("i am " + w))) {
    return ["done", stripped];
  }
  if (bare.length <= 48 && DONE_WORDS.some((w) => bare.includes(w))) return ["done", stripped];

  const looksLeft = room(turn, "look") > 0;
  const talksLeft = room(turn, "say") > 0;

  if (QUOTES.includes(stripped.slice(0, 1)) && talksLeft) {
    return ["say", stripped.replace(new RegExp(`^[${QUOTES}”’»]+|[${QUOTES}”’»]+$`, "g"), "")];
  }
  if (stripped.endsWith("?")) {
    if (looksLeft) return ["look", stripped];
    if (talksLeft) return ["say", stripped];
  }
  return ["done", stripped];
}

function commit(turn: TurnT, action: string) {
  turn.action = action;
  turn.nudge = 0;
  turn.roll = null;
  turn.fate = null;
  turn.check = null;
  turn.spent = [];
  phase(turn, "explorer", "action", action);
}

export const stepExplorer: Step<"explorer"> = async ({ campaign, turn }) => {
  if (pendingDeath()) return "quiet";
  const text = await askExplorer(
    campaign, prompts.explorerTurn(campaign.last_narration ?? null, turn.nudge, turn.check)
  );

  const stripped = firstUtterance(text);
  const upper = stripped.toUpperCase();
  const asked = upper.startsWith("LOOK:") || upper.startsWith("SAY:");

  if (!stripped) {
    turn.blank += 1;
    if (turn.blank >= MAX_ASKS) {
      turn.gap =
        "The adventurer has said nothing that can be acted on:\n\n" +
        String(text ?? "").trim().slice(0, 600);
      return "stuck";
    }
    return "again";
  }
  turn.blank = 0;

  if (!turn.action && !asked) {
    commit(turn, stripped);
    return "acts";
  }

  if (!turn.action && asked) {
    turn.nudge += 1;
    if (turn.nudge < MAX_ASKS) return "again";
    commit(turn, stripped.split(":").slice(1).join(":").trim());
    return "acts";
  }

  const [kind, said] = classify(stripped, turn);
  if (kind !== "done" && room(turn, kind) > 0) {
    turn.asking = { mode: kind, question: said };
    phase(turn, "explorer", kind, said);
    return "looks";
  }
  return "quiet";
};
