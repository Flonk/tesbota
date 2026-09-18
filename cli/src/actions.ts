/**
 * What anybody outside the loop can ask the world to do. The web steers the CLI,
 * and these are the verbs it steers with.
 *
 * Every one of them returns a plain object; the CLI prints it as the last line of
 * stdout, which is the whole of the protocol between the two halves.
 */

import fs from "node:fs";
import path from "node:path";
import * as canon from "./canon.ts";
import * as driver from "./driver.ts";
import * as prompts from "./prompts.ts";
import { ask } from "./agent.ts";
import { sqliteGate } from "./gate.ts";
import { MODELS, MYSTERY, STATE, WRITE_TOOLS } from "./config.ts";
import { edgeFrom, type StateName } from "./machine.ts";
import type { TurnT } from "./schema.ts";
import {
  loadCampaign, loadTurn, readJson, recordDeath, saveCampaign, saveTurn, writeJson,
} from "./state.ts";

const CHAT_FILE = path.join(STATE, "lore3.json");
const TALK_FILE = path.join(STATE, "lore4.json");

export const chatLog = (): any[] => (fs.existsSync(CHAT_FILE) ? readJson(CHAT_FILE) : []);

export function appendChat(role: string, text: string) {
  const log = chatLog();
  log.push({ role, text });
  writeJson(CHAT_FILE, log);
}

/**
 * Move the turn across one edge from outside the loop. The silence is settled by
 * a conversation, not by a step, and the two halves of it — you writing, and the
 * lore master answering — are two states that have to be written down as they
 * change hands or nothing watching can tell which of you is holding it.
 */
function hand(turn: TurnT, from: StateName, on: string): TurnT {
  turn.state = edgeFrom(from, on).to;
  driver.took(turn, from, on);
  saveTurn(turn);
  return turn;
}

const sitting = () =>
  fs.existsSync(TALK_FILE) ? readJson(TALK_FILE) : { session: null, log: [] };

export async function say(text: string) {
  const campaign = loadCampaign();
  if (!campaign.current_turn) return { error: "nothing is pending" };
  const turn = loadTurn(campaign.current_turn);
  // `lore3` here means an earlier answer was cut off mid-flight and left the turn
  // in the lore master's hands; asking again is how you take it back.
  if (turn.state !== "arbiter" && turn.state !== "lore3") {
    return { error: "nothing is pending" };
  }
  const session = (campaign.sessions as any).lore3_sitting;
  const message = session
    ? text
    : prompts.lore3Turn(turn.gap || "") + "\n\n" + text;
  appendChat("you", text);
  if (turn.state === "arbiter") hand(turn, "arbiter", "said");

  let reply: string;
  let next: unknown;
  try {
    [reply, next] = await ask(message, {
      system: prompts.LORE3_SYSTEM(),
      tools: WRITE_TOOLS,
      permission: sqliteGate({ readonly: false }),
      session,
      model: MODELS.lore3,
    });
  } catch (exc) {
    // Whatever went wrong, the turn does not stay in the hands of a layer that
    // is no longer answering — it goes back to you.
    hand(loadTurn(turn.turn_id), "lore3", "answered");
    throw exc;
  }

  const lines = reply.trim().split("\n").filter((l) => l.trim());
  let finished = !!lines.length && lines[lines.length - 1].trim() === "RESOLVED";
  const said = finished ? lines.slice(0, -1).join("\n").replace(/\s+$/, "") : reply;

  const held = loadCampaign();
  (held.sessions as any).lore3_sitting = next;
  saveCampaign(held);
  appendChat("lore master", said);

  const illegal = canon.illegalBooks();
  if (finished && illegal.length) {
    finished = false;
    const note =
      "Not resolved. These books are attributed to the one moving through this " +
      `world, which is not an author: ${illegal.join(", ")}. ` +
      "Direct observation is not testimony. Remove or reattribute them, then finish.";
    appendChat("driver", note);
    hand(loadTurn(held.current_turn!), "lore3", "answered");
    return { reply: said, resolved: false, rejected: note };
  }

  if (finished) await resolve();
  else hand(loadTurn(held.current_turn!), "lore3", "answered");
  return { reply: said, resolved: finished };
}

export async function talk(text: string) {
  const book = sitting();
  appendTalk("you", text);
  const [reply, session] = await ask(text, {
    system: prompts.LORE4_SYSTEM(),
    tools: WRITE_TOOLS,
    permission: sqliteGate({ readonly: false }),
    session: book.session,
    model: MODELS.lore4,
  });
  canon.linkWriting();
  const held = sitting();
  held.session = session;
  held.log.push({ role: "lore master", text: reply });
  writeJson(TALK_FILE, held);
  return { reply };
}

function appendTalk(role: string, text: string) {
  const held = sitting();
  held.log.push({ role, text });
  writeJson(TALK_FILE, held);
}

export function setNote(text: string | null) {
  const campaign = loadCampaign();
  campaign.note = String(text ?? "").trim() || null;
  saveCampaign(campaign);
  return { ok: true, note: campaign.note };
}

export async function resolve() {
  const campaign = loadCampaign();
  if (!campaign.current_turn) return { error: "nothing is pending" };
  let turn = loadTurn(campaign.current_turn);
  // Settling it yourself is you doing the lore master's half of it, so the turn
  // goes through the same state on its way out.
  if (turn.state === "arbiter") turn = hand(turn, "arbiter", "said");
  if (turn.state !== "lore3") return { error: "nothing is pending" };
  (campaign.sessions as any).lore3_sitting = null;
  saveCampaign(campaign);

  canon.linkWriting();

  const transcript = chatLog();
  if (transcript.length) (turn as any).lore = [...((turn as any).lore || []), ...transcript];
  (turn as any).lore_gap = turn.gap || (turn as any).lore_gap;

  driver.resolveGap(campaign, turn);
  writeJson(CHAT_FILE, []);

  try {
    const ran = await driver.run(1);
    return { ok: true, state: ran.state, turn: ran.turn.turn_id };
  } catch (exc) {
    const held = loadCampaign();
    return {
      ok: true,
      error: `${(exc as Error).name}: ${exc}`.slice(0, 600),
      turn: held.current_turn,
    };
  }
}

/**
 * Stop the clock turning the world over. Nothing in flight is lost — the next step
 * simply does not run until it is let go again.
 */
export function pause(on = true) {
  const campaign = loadCampaign();
  campaign.paused = !!on;
  saveCampaign(campaign);
  return { ok: true, paused: campaign.paused };
}

/**
 * How many minutes of world time pass in a minute of ours. 1 is real time; the
 * prototype runs thousands to the minute so a day's walk is not a day's wait.
 */
export function setSpeed(factor: unknown) {
  const campaign = loadCampaign();
  const clock = ((campaign as any).clock ||= {});
  clock.speed_factor = Math.max(1, Math.min(20000, Math.trunc(Number(factor))));
  saveCampaign(campaign);
  return { ok: true, speed: clock.speed_factor };
}

/**
 * Ask for a death. The driver carries it out, because the game master may be
 * calling for one in the middle of a turn that still has to be written.
 */
export const kill = (cause?: string | null) => ({ ok: true, cause: recordDeath(cause || MYSTERY) });

export async function step() {
  try {
    const ran = await driver.run(1);
    return { state: ran.state, turn: ran.turn.turn_id };
  } catch (exc) {
    const campaign = loadCampaign();
    return {
      error: `${(exc as Error).name}: ${exc}`.slice(0, 600),
      turn: campaign.current_turn,
    };
  }
}
