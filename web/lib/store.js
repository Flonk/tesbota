import { execFile, spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export const ROOT = path.resolve(process.cwd(), "..");
const STATE = path.join(ROOT, "state");
const TURNS = path.join(STATE, "turns");
const JOB = path.join(STATE, "job.json");
const JOB_LOG = path.join(STATE, "job.log");

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

const PREFIX = /^\s*(action|do|act)\s*:\s*/i;
const BANDS = { very_rare: "epic" };
const band = (name) => BANDS[name] || name;
const plain = (text) => (typeof text === "string" ? text.replace(PREFIX, "") : text);

export async function snapshot() {
  const campaign = await readJson(path.join(STATE, "campaign.json"), {});
  const chat = await readJson(path.join(STATE, "lore3.json"), []);
  const sitting = await readJson(path.join(STATE, "lore4.json"), { log: [] });

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
    if (turn.arrival) cue = `arrives at ${turn.arrival.replace(/-/g, " ")}`;
    else if (turn.event) cue = "something on the road";

    const verdicts = {};
    for (const v of turn.verdicts || []) verdicts[v.claim] = v;

    const phases = (turn.phases || []).map((x) => ({
      ...x,
      text: plain(x.text),
      outcomes: (x.outcomes || []).map((o) => ({ ...o, band: band(o.band) })),
      chosen: x.chosen ? { ...x.chosen, band: band(x.chosen.band) } : x.chosen,
    }));
    if (!phases.length && !turn.action && !draft.narration && !cue) continue;

    slides.push({
      id: turn.turn_id,
      state: turn.state,
      cue,
      phases,
      action: plain(turn.action),
      narration: turn.looking ? null : draft.narration,
      pending: turn.looking
        ? { mode: turn.mode || "look", question: turn.question, answer: draft.narration || null }
        : null,
      claims: phases.flatMap((x) =>
        (x.claims || []).map((c) => ({ ...c, key: `${x.n}-${c.id}` }))
      ),
      minutes: draft.minutes || 0,
      fatigue: draft.fatigue || 0,
      health: draft.health || 0,
      roll: turn.roll || null,
      calamity: !!turn.calamity,
      retries: turn.gm_retries || 0,
      travel: draft.travel || null,
      where:
        turn.location_path ||
        (turn.turn_id === campaign.current_turn ? campaign.location_path || [] : []),
      vitals: turn.vitals || null,
      quest: turn.quest || null,
      at: turn.at || null,
      note: turn.note || null,
      lore: turn.lore || [],
      loreGap: turn.lore_gap || null,
    });
  }

  const current = turns.find((t) => t.turn_id === campaign.current_turn) || null;
  const t = campaign.time || {};
  const now = t.long || t.stamp || null;

  const status = {
    state: current?.state || "uninitialised",
    who: campaign.explorer || null,
    speed: campaign.clock?.speed_factor ?? null,
    paused: !!campaign.paused,
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
  const quests = campaign.quests || [];
  const inventory = holdings(EXPLORER);

  const gap =
    current?.state === "awaiting_human" ? { turn: current.turn_id, text: current.gap || "" } : null;

  return { status, slides, gap, chat, talk: sitting.log || [], vitals, skills, inventory, quests, names: names(), job: await job(), note: campaign.note || null };
}

function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const CANON = path.join(ROOT, "canon.db");
const EXPLORER = "the-explorer";

function canon() {
  return new DatabaseSync(`file:${CANON}?mode=ro`, { open: true });
}

export function holdings(holder) {
  let db;
  try {
    db = canon();
  } catch {
    return [];
  }
  try {
    return holdingsIn(db, holder);
  } catch {
    return [];
  } finally {
    db.close();
  }
}

export async function library() {
  let db;
  try {
    db = canon();
  } catch {
    return [];
  }
  try {
    const rows = db
      .prepare(
        `SELECT e.id, e.name, b.author, b.author_id, b.written, b.rarity,
                (SELECT count(*) FROM passage p WHERE p.book_id = b.id) AS passages,
                (SELECT count(*) FROM writing w WHERE w.body LIKE '%/' || e.id || '%') AS mentions,
                       (EXISTS (SELECT 1 FROM writing w WHERE w.entity = e.id AND w.body LIKE '%$BOTA%')
          OR EXISTS (SELECT 1 FROM person pr WHERE pr.id = e.id
                       AND (pr.work LIKE '%$BOTA%' OR pr.lives LIKE '%$BOTA%'
                            OR pr.born LIKE '%$BOTA%' OR pr.died LIKE '%$BOTA%'))) AS stub
           FROM book b JOIN entity e ON e.id = b.id
          ORDER BY lower(e.name)`
      )
      .all();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      author: (r.author || "").trim(),
      authorId: r.author_id || null,
      written: r.written || "",
      rarity: (r.rarity || "").toLowerCase(),
      passages: r.passages,
      mentions: r.mentions,
      stub: !!r.stub,
      godhead: ["the godhead", "the narrator"].includes((r.author || "").trim().toLowerCase()),
    }));
  } finally {
    db.close();
  }
}

const ROWS = `
  SELECT e.id, e.kind, e.name, e.introduced,
         pl.parent AS parent,
         coalesce(pe.name, replace(pl.parent, '-', ' ')) AS parentName,
         (SELECT count(*) FROM place x WHERE x.parent = e.id) AS contains,
         (SELECT count(*) FROM way x WHERE x.src = e.id) AS exits,
         (SELECT count(*) FROM holding h WHERE h.holder = e.id) AS keeps,
         (SELECT count(*) FROM writing w WHERE w.body LIKE '%/' || e.id || '%') AS mentions,
         (SELECT count(*) FROM book b WHERE b.author_id = e.id) AS wrote,
         (SELECT pr.work FROM person pr WHERE pr.id = e.id) AS work,
         (SELECT pr.born FROM person pr WHERE pr.id = e.id) AS born,
         (SELECT pr.died FROM person pr WHERE pr.id = e.id) AS died,
         (SELECT pr.lives FROM person pr WHERE pr.id = e.id) AS lives,
         (SELECT coalesce(le.name, replace(pr.lives, '-', ' ')) FROM person pr
            LEFT JOIN entity le ON le.id = pr.lives WHERE pr.id = e.id) AS livesName,
         (SELECT h.holder FROM holding h WHERE h.item = e.id LIMIT 1) AS holder,
         (SELECT it.rarity FROM item it WHERE it.id = e.id) AS rarity,
         (EXISTS (SELECT 1 FROM writing w WHERE w.entity = e.id AND w.body LIKE '%$BOTA%')
          OR EXISTS (SELECT 1 FROM person pr WHERE pr.id = e.id
                       AND (pr.work LIKE '%$BOTA%' OR pr.lives LIKE '%$BOTA%'
                            OR pr.born LIKE '%$BOTA%' OR pr.died LIKE '%$BOTA%'))) AS stub
    FROM entity e
    LEFT JOIN place pl ON pl.id = e.id
    LEFT JOIN entity pe ON pe.id = pl.parent
`;

export function names() {
  let db;
  try {
    db = canon();
  } catch {
    return {};
  }
  try {
    const out = {};
    for (const r of db.prepare(`SELECT id, kind, name FROM entity`).all()) {
      out[r.id] = { kind: r.kind, name: r.name };
    }
    return out;
  } finally {
    db.close();
  }
}

export function entities(kind) {
  let db;
  try {
    db = canon();
  } catch {
    return kind ? [] : {};
  }
  try {
    const rows = db
      .prepare(`${ROWS} WHERE e.kind = ? ORDER BY lower(e.name)`);
    const shape = (r) => ({
      ...r,
      parent: r.parent || null,
      parentName: r.parent ? r.parentName : null,
      holder: r.holder || null,
      rarity: r.rarity || null,
      work: r.work || "",
      born: r.born || "",
      died: r.died || "",
      lives: r.lives || null,
      livesName: r.lives ? r.livesName : "",
      stub: !!r.stub,
    });
    if (kind) return rows.all(kind).map(shape);
    const out = {};
    for (const k of ["places", "people", "items"]) out[k] = rows.all(k).map(shape);
    return out;
  } finally {
    db.close();
  }
}

export function entity(id) {
  const ident = String(id || "").trim().toLowerCase();
  if (!ident) return null;
  let db;
  try {
    db = canon();
  } catch {
    return null;
  }
  try {
    const row = db
      .prepare(`SELECT id, kind, name, introduced, about FROM entity WHERE id = ?`)
      .get(ident);
    if (!row) return null;


    const mentions = db
      .prepare(
        `SELECT w.ref, w.entity, w.kind, w.section, w.body,
                coalesce(e.name, w.entity) AS name
           FROM writing w LEFT JOIN entity e ON e.id = w.entity
          WHERE w.body LIKE ? ORDER BY w.ref`
      )
      .all(`%/${ident}%`)
      .map((m) => ({
        ref: m.ref,
        entity: m.entity,
        kind: m.kind,
        section: m.section,
        name: m.name,
        snippet: around(m.body, `/${ident}`),
      }));

    const held = db
      .prepare(
        `SELECT h.holder, coalesce(e.name, replace(h.holder, '-', ' ')) AS name, h.qty
           FROM holding h LEFT JOIN entity e ON e.id = h.holder
          WHERE h.item = ? ORDER BY h.holder`
      )
      .all(ident);

    const bundle = {
      ...row,
      address: `bota://${row.kind}/${row.id}`,
      about: row.about || "",
      claims: [],
      mentions,
      holdings: holdingsIn(db, ident),
      heldBy: held,
      stub: !!db
        .prepare(`SELECT 1 FROM writing WHERE entity = ? AND body LIKE '%$BOTA%'`)
        .get(ident),
    };

    if (row.kind === "places" || row.kind === "items") {
      bundle.within = db
        .prepare(
          `WITH RECURSIVE up(id, depth) AS (
             SELECT ?, 0
             UNION
             SELECT pl.parent, up.depth + 1 FROM place pl JOIN up ON pl.id = up.id
              WHERE up.depth < 24 AND pl.parent IS NOT NULL
           )
           SELECT up.id, coalesce(entity.name, replace(up.id, '-', ' ')) AS name, entity.kind
             FROM up LEFT JOIN entity ON entity.id = up.id ORDER BY up.depth DESC`
        )
        .all(ident);
    }

    if (row.kind === "places") {
      bundle.contains = db
        .prepare(
          `SELECT pl.id AS id, coalesce(t.name, replace(pl.id, '-', ' ')) AS name, t.kind
             FROM place pl LEFT JOIN entity t ON t.id = pl.id
            WHERE pl.parent = ? ORDER BY pl.id`
        )
        .all(ident);
      bundle.exits = db
        .prepare(
          `SELECT w.dst AS id, coalesce(t.name, replace(w.dst, '-', ' ')) AS name,
                  w.bearing, w.distance, t.id IS NOT NULL AS known
             FROM way w LEFT JOIN entity t ON t.id = w.dst
            WHERE w.src = ? ORDER BY w.dst`
        )
        .all(ident)
        .map((x) => ({ ...x, known: !!x.known }));
    }

    if (row.kind === "people") {
      bundle.person =
        db
          .prepare(
            `SELECT p.work, p.lives, p.born, p.died, p.traits,
                    coalesce(l.name, replace(p.lives, '-', ' ')) AS livesName
               FROM person p LEFT JOIN entity l ON l.id = p.lives WHERE p.id = ?`
          )
          .get(ident) || null;
      bundle.wrote = db
        .prepare(
          `SELECT b.id, e.name, b.written, b.rarity
             FROM book b JOIN entity e ON e.id = b.id
            WHERE b.author_id = ? ORDER BY lower(e.name)`
        )
        .all(ident);
    }

    if (row.kind === "items") {
      bundle.item =
        db.prepare(`SELECT type, slot, rarity, worth, owed_by FROM item WHERE id = ?`).get(ident) ||
        null;
      if (bundle.item) {
        bundle.item.effects = db
          .prepare(`SELECT stat, amount FROM effect WHERE item = ? ORDER BY id`)
          .all(ident);
      }
    }

    if (row.kind === "books") {
      const book = db
        .prepare(`SELECT author, author_id, written, rarity FROM book WHERE id = ?`)
        .get(ident);
      bundle.book = book
        ? {
            ...book,
            author: (book.author || "").trim(),
            godhead: ["the godhead", "the narrator"].includes(
              (book.author || "").trim().toLowerCase()
            ),
          }
        : null;
      bundle.passages = db
        .prepare(`SELECT ord, text FROM passage WHERE book_id = ? ORDER BY ord`)
        .all(ident);
    }

    return bundle;
  } finally {
    db.close();
  }
}

function around(body, needle, width = 90) {
  const text = String(body || "");
  const at = text.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return text.slice(0, width * 2);
  const start = Math.max(0, at - width);
  const end = Math.min(text.length, at + needle.length + width);
  return (start ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
}

function holdingsIn(db, holder) {
  const kept = db
    .prepare(
      `SELECT h.item, coalesce(e.name, replace(h.item, '-', ' ')) AS name, i.type, i.slot, i.rarity,
              i.worth, h.qty, h.worn
         FROM holding h
         LEFT JOIN entity e ON e.id = h.item
         LEFT JOIN item i ON i.id = h.item
        WHERE h.holder = ? ORDER BY h.id`
    )
    .all(holder);
  const powers = {};
  for (const r of db
    .prepare(
      `SELECT f.item, f.stat, f.amount
         FROM effect f JOIN holding h ON h.item = f.item
        WHERE h.holder = ? ORDER BY f.id`
    )
    .all(holder)) {
    (powers[r.item] ||= []).push({ stat: r.stat, amount: r.amount });
  }
  return kept.map((r) => ({
    id: r.item,
    name: r.name,
    type: r.type || "",
    slot: r.slot || null,
    rarity: r.rarity || null,
    worth: r.worth || null,
    effects: powers[r.item] || [],
    qty: r.qty || 1,
    worn: !!r.worn,
  }));
}

export async function look(question) {
  const text = (question || "").trim();
  if (!text) return [];
  let db;
  try {
    db = canon();
  } catch {
    return [];
  }
  try {
    const rows = db
      .prepare(
        `SELECT s.ref, s.entity, s.section,
                snippet(search, 3, '<<', '>>', '…', 14) AS hit,
                coalesce(e.name, s.entity) AS name, e.kind
           FROM search s LEFT JOIN entity e ON e.id = s.entity
          WHERE search MATCH ?
          ORDER BY rank LIMIT 40`
      )
      .all(text);
    return rows;
  } catch (err) {
    return [{ error: String(err.message || err) }];
  } finally {
    db.close();
  }
}

function runner(args) {
  const own = path.join(ROOT, ".venv/bin/python");
  return fsSync.existsSync(own)
    ? [own, ["-m", "tesbota.cli", ...args]]
    : ["uv", ["run", "--directory", ROOT, "tesbota", ...args]];
}

export async function mapLayout() {
  const [command, args] = runner(["map", "--json"]);
  try {
    const { stdout } = await run(command, args, {
      cwd: ROOT,
      timeout: 60000,
      maxBuffer: 1024 * 1024 * 8,
    });
    return JSON.parse(stdout.trim().split("\n").pop());
  } catch (err) {
    return { error: String(err.stderr || err.message || err).trim().slice(-400) };
  }
}

export async function job() {
  const j = await readJson(JOB, null);
  if (!j) return { running: false, label: null, error: null };
  const running = alive(j.pid);
  return { running, label: j.label || null, error: running ? null : j.error || null };
}

export async function launch(args, label) {
  const current = await readJson(JOB, null);
  if (current && alive(current.pid)) return { busy: true, label: current.label || null };

  const log = fsSync.openSync(JOB_LOG, "w");
  const [command, argv] = runner(args);
  const child = spawn(command, argv, {
    cwd: ROOT,
    stdio: ["ignore", log, log],
    detached: true,
  });
  child.unref();

  const record = { pid: child.pid, label, since: new Date().toISOString(), error: null };
  await fs.writeFile(JOB, JSON.stringify(record, null, 2) + "\n");

  child.on("exit", async (code, signal) => {
    let out = "";
    try {
      out = await fs.readFile(JOB_LOG, "utf8");
    } catch {}
    let error = null;
    if (signal) {
      error = null;
    } else if (code !== 0) {
      const real = out
        .split("\n")
        .filter((l) => l.trim() && !/Warning:|^\s+\w|^\s*$/.test(l))
        .join("\n")
        .trim();
      error = (real || out.trim()).slice(-700) || `${label} exited with ${code}`;
    } else {
      try {
        const parsed = JSON.parse(out.trim().split("\n").pop() || "");
        if (parsed?.error && parsed.error !== "nothing is pending") {
          error = String(parsed.error).slice(-700);
        }
      } catch {}
    }
    try {
      fsSync.closeSync(log);
    } catch {}
    await fs
      .writeFile(JOB, JSON.stringify({ ...record, pid: null, code, error }, null, 2) + "\n")
      .catch(() => {});
  });

  return { started: true, label };
}

export async function tesbota(args, timeout = 900000) {
  let stdout;
  const [command, argv] = runner(args);
  try {
    ({ stdout } = await run(command, argv, {
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
