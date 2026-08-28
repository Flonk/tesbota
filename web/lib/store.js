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

  const slides = [];
  for (const turn of turns) {
    const draft = turn.draft || {};
    let cue = null;
    if (turn.arrival) cue = `arrives at ${turn.arrival}`;
    else if (turn.event) cue = "something on the road";

    const verdicts = {};
    for (const v of turn.verdicts || []) verdicts[v.claim] = v;

    const exchanges = turn.exchanges || [];
    if (!exchanges.length && !turn.action && !draft.narration && !cue) continue;

    slides.push({
      id: turn.turn_id,
      state: turn.state,
      cue,
      exchanges,
      action: turn.action,
      narration: turn.looking ? null : draft.narration,
      pending: turn.looking
        ? { mode: turn.mode || "look", question: turn.question, answer: draft.narration || null }
        : null,
      claims: (draft.claims || []).map((c) => ({ ...c, verdict: verdicts[c.id] || null })),
      quotes: draft.quotes || [],
      minutes: draft.minutes || 0,
      fatigue: draft.fatigue || 0,
      health: draft.health || 0,
      roll: turn.roll || null,
      risk: turn.risk || null,
      calamity: !!turn.calamity,
      retries: turn.gm_retries || 0,
      travel: draft.travel || null,
      looks: turn.looks || [],
      talks: turn.talks || [],
      where: turn.location_path || [],
      quest: turn.quest || null,
      at: turn.at || null,
      note: turn.note || null,
      lore: turn.lore || [],
      loreGap: turn.lore_gap || null,
    });
  }

  const current = turns.find((t) => t.turn_id === campaign.current_turn) || null;
  const t = campaign.time || {};
  const mins = Number(t.minute ?? 0);
  const now =
    t.era !== undefined
      ? `${t.era}E${t.year} ${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`
      : null;

  const status = {
    state: current?.state || "uninitialised",
    turn: campaign.current_turn || null,
    where: campaign.location_path || [],
    now,
    day: t.day ?? null,
  };
  if (current?.wake_at) {
    status.destination = current.destination;
    status.wakesIn = duration(minutesUntil(current.wake_at));
    status.events = (current.schedule || []).filter((e) => !e.fired).length;
  }
  if (campaign.suspended_journey) status.held = campaign.suspended_journey.destination;

  const vitals = campaign.vitals || { health: 100, fatigue: 0, hunger: 0 };
  const skills = campaign.skills || {};
  const notebook = campaign.notebook || [];
  const quests = campaign.quests || [];
  const inventory = (campaign.inventory || []).map((e) =>
    typeof e === "string"
      ? { name: e, qty: 1, note: "", worn: false }
      : { name: e.name || "something", qty: e.qty || 1, note: e.note || "", worn: !!e.worn }
  );

  const gap =
    current?.state === "awaiting_human" ? { turn: current.turn_id, text: current.gap || "" } : null;

  return { status, slides, gap, chat, vitals, skills, inventory, notebook, quests, note: campaign.note || null };
}

export async function tesbota(args, timeout = 900000) {
  let stdout;
  try {
    ({ stdout } = await run("uv", ["run", "--directory", ROOT, "tesbota", ...args], {
      cwd: ROOT,
      timeout,
      maxBuffer: 1024 * 1024 * 16,
    }));
  } catch (err) {
    const detail = (err.stderr || err.message || String(err)).trim();
    return { error: detail.slice(-700) };
  }

  const line = stdout.trim().split("\n").pop();
  try {
    return JSON.parse(line);
  } catch {
    return { error: stdout.trim().slice(-700) || "the step produced no result" };
  }
}
