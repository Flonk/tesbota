import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export const ROOT = path.resolve(process.cwd(), "..");
const STATE = path.join(ROOT, "state");
const TURNS = path.join(STATE, "turns");

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

function minutesUntil(iso) {
  return Math.max(0, Math.round((new Date(iso) - Date.now()) / 60000));
}

function duration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export async function snapshot() {
  const campaign = await readJson(path.join(STATE, "campaign.json"), {});
  const chat = await readJson(path.join(STATE, "lore3.json"), []);

  let files = [];
  try {
    files = (await fs.readdir(TURNS)).filter((f) => f.endsWith(".json")).sort();
  } catch {}

  const turns = [];
  for (const file of files) {
    const turn = await readJson(path.join(TURNS, file));
    if (turn) turns.push(turn);
  }

  const story = [];
  const machinery = [];
  for (const turn of turns) {
    const draft = turn.draft || {};
    let cue = null;
    if (turn.arrival) cue = `arrives at ${turn.arrival}`;
    else if (turn.event) cue = "something on the road";

    if (turn.action || draft.narration || cue) {
      story.push({ id: turn.turn_id, cue, action: turn.action, narration: draft.narration });
    }
    if ((draft.claims || []).length || (turn.verdicts || []).length || turn.correction) {
      machinery.push({
        id: turn.turn_id,
        minutes: draft.minutes || 0,
        fatigue: draft.fatigue || 0,
        claims: draft.claims || [],
        verdicts: turn.verdicts || [],
        quotes: draft.quotes || [],
        correction: turn.correction,
        retries: turn.gm_retries || 0,
        travel: draft.travel || null,
      });
    }
  }

  const current = turns.find((t) => t.turn_id === campaign.current_turn) || null;
  const status = { state: current?.state || "uninitialised", turn: campaign.current_turn || null };
  if (current?.wake_at) {
    status.destination = current.destination;
    status.wakesIn = duration(minutesUntil(current.wake_at));
    status.events = (current.schedule || []).filter((e) => !e.fired).length;
  }
  if (campaign.suspended_journey) status.held = campaign.suspended_journey.destination;

  const vitals = campaign.vitals || { health: 100, fatigue: 0 };

  const gap =
    current?.state === "awaiting_human" ? { turn: current.turn_id, text: current.gap || "" } : null;

  return { status, story, machinery, gap, chat, vitals };
}

export async function tesbota(args, timeout = 900000) {
  const { stdout } = await run("uv", ["run", "--directory", ROOT, "tesbota", ...args], {
    cwd: ROOT,
    timeout,
    maxBuffer: 1024 * 1024 * 16,
  });
  const line = stdout.trim().split("\n").pop();
  try {
    return JSON.parse(line);
  } catch {
    return { output: stdout.trim() };
  }
}
