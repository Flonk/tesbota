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

const sitting = () =>
  fs.existsSync(TALK_FILE) ? readJson(TALK_FILE) : { session: null, log: [] };

export async function say(text: string) {
  const campaign = loadCampaign();
  if (!campaign.current_turn) return { error: "nothing is pending" };
  const turn = loadTurn(campaign.current_turn);
  if (turn.state !== "awaiting_human") return { error: "nothing is pending" };
  const session = (campaign.sessions as any).lore3_sitting;
  const message = session
    ? text
    : prompts.lore3Turn(turn.gap || "") + "\n\n" + text;
  appendChat("you", text);

  const [reply, next] = await ask(message, {
    system: prompts.LORE3_SYSTEM(),
    tools: WRITE_TOOLS,
    permission: sqliteGate({ readonly: false }),
    session,
    model: MODELS.lore3,
  });

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
    return { reply: said, resolved: false, rejected: note };
  }

  if (finished) await resolve();
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
  const turn = loadTurn(campaign.current_turn);
  if (turn.state !== "awaiting_human") return { error: "nothing is pending" };
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
