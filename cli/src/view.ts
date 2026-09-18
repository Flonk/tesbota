/** What the terminal sees. Nothing here decides anything; it only sets it out. */

import { allTurns, now, parse } from "./state.ts";
import type { CampaignT, TurnT } from "./schema.ts";

export const DIM = "\x1b[2m";
export const BOLD = "\x1b[1m";
export const WARN = "\x1b[33m";
export const OFF = "\x1b[0m";

export function duration(ms: number): string {
  const seconds = Math.max(0, Math.trunc(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}

export function wrap(text: string | null | undefined, width = 76, indent = "  "): string {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line.length + word.length + 1 > width) {
      lines.push(indent + line);
      line = word;
    } else {
      line = `${line} ${word}`.trim();
    }
  }
  if (line) lines.push(indent + line);
  return lines.join("\n");
}

export function* beats(turns: TurnT[]) {
  for (const turn of turns) {
    let cue: string | null = null;
    if (turn.arrival) cue = `arrives at ${turn.arrival}`;
    else if (turn.event) cue = "something on the road";
    yield { turn, cue, action: turn.action ?? null, narration: turn.draft?.narration ?? null };
  }
}

export function renderLog(turns: TurnT[], since?: string | null): string {
  const out: string[] = [];
  for (const { turn, cue, action, narration } of beats(turns)) {
    if (!(action || narration || cue)) continue;
    const mark = since && turn.turn_id > since ? " *" : "";
    out.push(`${DIM}── ${turn.turn_id}${mark}${OFF}`);
    if (cue) out.push(`${DIM}   ${cue}${OFF}`);
    if (action) out.push(`${BOLD}${wrap(action)}${OFF}`);
    if (narration) out.push(wrap(narration));
    out.push("");
  }
  return out.join("\n").replace(/\s+$/, "");
}

export function renderStatus(campaign: CampaignT, turn: TurnT): string {
  const lines = [`${BOLD}tesbota${OFF} ${DIM}— ${turn.turn_id}${OFF}`, ""];
  const state = turn.state;

  if (state === "awaiting_clock") {
    const left = parse(String(turn.wake_at)).getTime() - now().getTime();
    lines.push(`  the adventurer is on the road to ${(turn as any).destination}`);
    lines.push(
      `  wakes in ${duration(left)}` +
        ((turn as any).leagues_left ? ", and the road does not get them there" : "")
    );
  } else if (state === "awaiting_human") {
    lines.push(`  ${WARN}the lore master is waiting on you${OFF} — run: tesbota lore`);
    lines.push("");
    for (const line of String(turn.gap ?? "").trim().split("\n")) lines.push(`  ${line}`);
  } else if (state === "done") {
    lines.push("  the adventurer is between turns");
  } else {
    lines.push(`  mid-turn: ${state}`);
  }

  const seen = campaign.last_seen;
  const fresh = allTurns()
    .filter((t) => !seen || t.turn_id > seen)
    .filter((t) => t.action || t.draft?.narration);
  if (fresh.length) {
    lines.push("", `  ${fresh.length} new turn(s) since you last looked — run: tesbota log`);
  }

  const narration = campaign.last_narration;
  if (narration && state !== "awaiting_human") {
    lines.push("", `${DIM}  last seen:${OFF}`, wrap(narration));
  }
  return lines.join("\n");
}
