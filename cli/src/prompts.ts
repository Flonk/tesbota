/**
 * Every message an agent is handed, and every system prompt behind one.
 *
 * The prompts themselves are markdown on disk in `prompts/` — they are
 * the world's text, not code, and they stay there. This assembles them, fills in
 * the few things that change with the life being lived, and builds the per-turn
 * messages around them.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AGENTS } from "./agents.ts";
import { does, type Holding, type holdingsAt } from "./canon.ts";
import { EXPLORER, FLEE_FLOOR, MAX_FATIGUE, MAX_HEALTH, MAX_HUNGER, ROOT } from "./config.ts";
import { bookId, bookTitle } from "./chronicle.ts";
import { explorerName } from "./state.ts";
import { ARRIVED } from "./fight.ts";
import type { Load } from "./sheet.ts";
import {
  Written,
  type BlowT, type CarriedT, type CheckT, type DraftT, type FightT, type FighterT, type JourneyT,
  type OutcomeT, type PlacedT, type ProposalT, type QuestT, type VitalsT,
} from "./schema.ts";

type Keeps = ReturnType<typeof holdingsAt>;

export const PROMPTS = path.join(ROOT, "prompts");
const INCLUDE = ["COMMON", "WRITING"];

/**
 * A prompt is a file. `$COMMON` on a line of its own pulls in the block every
 * agent above the explorer shares, so what is read here is what the agent is sent.
 */
export function block(name: string): string {
  let text = fs.readFileSync(path.join(PROMPTS, `${name}.md`), "utf8");
  for (const part of INCLUDE) {
    if (text.includes(`$${part}`)) {
      const held = fs.readFileSync(path.join(PROMPTS, `${part.toLowerCase()}.md`), "utf8");
      text = text.split(`$${part}`).join(held.replace(/\n+$/, ""));
    }
  }
  return text;
}

/**
 * The explorer has a name and their book is named after them; both change when a
 * new one sets out.
 */
export const fill = (text: string | null | undefined): string =>
  String(text ?? "")
    .split("$CHRONICLE_ID").join(bookId())
    .split("$CHRONICLE_NAME").join(bookTitle())
    .split("$EXPLORER").join(explorerName())
    .split("$HOLDER").join(EXPLORER);

/** One of a thing says nothing; a debt has to say itself. */
export function tally(qty: unknown): string {
  const n = Math.trunc(Number(qty) || 1);
  if (n < 0) return ` (owes ${Math.abs(n)})`;
  return n > 1 ? ` x${n}` : "";
}

/**
 * The game master keeps one session for the whole campaign, so a block it has
 * already been handed is not worth the tokens of handing over again. What moved
 * is spelled out; what did not gets a line saying so.
 */
export function told(
  parts: string[], sent: Record<string, string> | null | undefined,
  key: string, head: string, body: string, still: string
) {
  const mark = crypto.createHash("sha1").update(body, "utf8").digest("hex").slice(0, 16);
  if (sent == null || sent[key] !== mark) {
    if (sent != null) sent[key] = mark;
    parts.push(`${head}\n${body}`);
  } else {
    parts.push(still);
  }
}

const num = (n: unknown) => String(Number(n) || 0);

export function renderQuests(quests: QuestT[] | null | undefined): string {
  const lines: string[] = [];
  for (const q of quests || []) {
    if (q.status !== "active") continue;
    const giver = q.giver ? `, set by ${q.giver}` : "";
    lines.push(`  [${q.id}] ${q.title}${giver}`);
    if (q.detail) lines.push(`      ${q.detail}`);
    if (q.script) {
      lines.push("      script, yours alone:");
      for (const beat of String(q.script).split("\n")) {
        if (beat.trim()) lines.push(`        ${beat.trim()}`);
      }
    }
  }
  return lines.join("\n") || "  (nothing)";
}

export function gmInventory(items: Holding[] | null | undefined, load?: Load | null): string {
  const lines: string[] = [];
  for (const item of items || []) {
    const where = item.worn ? " (worn)" : "";
    const effects = item.effects.length ? ` — ${does(item.effects)}` : "";
    lines.push(`  - ${item.name}${tally(item.qty)}${where}${effects}`);
  }
  let out = lines.join("\n") || "  (nothing)";
  if (load) {
    let said = `  they are carrying ${num(load.carried)} of ${num(load.capacity)} stone`;
    if (load.over) {
      said +=
        `, which is past what they can manage — every stretch of road takes ` +
        `${num(load.drag ?? 1)} times as long, and they feel every step of it`;
    }
    out += "\n" + said;
  }
  return out;
}

export function gmHoldings(holders: Keeps | null | undefined): string {
  const lines: string[] = [];
  for (const holder of holders || []) {
    lines.push(`  ${holder.name} (${holder.id}):`);
    for (const item of holder.items || []) lines.push(`    - ${item.name}${tally(item.qty)}`);
  }
  return lines.join("\n") || "  (nothing)";
}

const signed = (n: unknown) => `${Number(n) >= 0 ? "+" : ""}${Number(n)}`;

export function explorerTurn(narration: string | null, nudge?: unknown, check?: CheckT | null): string {
  let text = narration || "You become aware. That is all, for now.";
  if (check) {
    const dice = (check.rolls.length ? check.rolls : [check.roll]).join(" ");
    let line =
      `\n\nYou tried it: ${check.skill}, d20 ${dice} ${signed(check.bonus)} ` +
      `against ${check.dc} — you ${check.passed ? "made it" : "fell short"}.`;
    if (check.against.length) {
      line +=
        ` You are ${check.against.join(" and ")}, so you threw ` +
        `${check.rolls.length} dice and kept the worst.`;
    }
    text += line;
  }
  if (nudge) {
    text +=
      "\n\nYou have not said what you are doing this turn. Looking and speaking " +
      "come after that, never before it. Say what you do.";
  }
  return text;
}

export const CARRY_SAME = "What they are carrying is exactly as you were last told.";
export const KEEP_SAME = "What everything here keeps is exactly as you were last told.";
export const QUEST_SAME = "What they have taken on is exactly as you were last told.";

const noteBlock = (note: string) =>
  "A note from the one who keeps this world. Nobody in the story speaks it " +
  "and the adventurer must never learn of it — direction, not an event:" +
  `\n\n${note}`;

const vitalsBlock = (v: VitalsT) =>
  `Their condition: health ${v.health}/${MAX_HEALTH}, fatigue ${v.fatigue}/${MAX_FATIGUE}, ` +
  `hunger ${v.hunger}/${MAX_HUNGER}.`;

const lastTold = (previous: string) => `What the adventurer was last told:\n\n${previous}`;

function kitBlocks(
  parts: string[], sent: Record<string, string> | null,
  { inventory = null, load = null, others = null, quests = null }:
  { inventory?: Holding[] | null; load?: Load | null; others?: Keeps | null; quests?: QuestT[] | null }
) {
  if (inventory != null) {
    told(parts, sent, "inventory", "What they are carrying:", gmInventory(inventory, load), CARRY_SAME);
  }
  if (others) {
    told(parts, sent, "others", "What everything here keeps, and it is the whole of it:",
         gmHoldings(others), KEEP_SAME);
  }
  if (quests) told(parts, sent, "quests", "What they have taken on:", renderQuests(quests), QUEST_SAME);
}

const VERBS = (weapon: string, weaponDamage: string, kit: string) =>
  `  ATTACK <who>    swing with the ${weapon}, ${weaponDamage} damage
  ITEM <name>     use one thing you carry, and it is gone${kit}
  SKILL <name>    go at it another way, with one of the eighteen
  FLEE            get out`;

/** Who is still up, on both sides, and how much is left in them. */
export function sides(fight: FightT): string {
  const row = (x: FighterT, mine: boolean) => {
    if (x.dead) return `  ${x.name} — down`;
    const asleep = x.asleep ? " (not stirring)" : "";
    return `  ${x.name} — ${x.health} left${asleep}` + (mine ? " (you)" : "");
  };
  const ours = fight.us.map((x, n) => row(x, n === 0)).join("\n");
  const theirs = fight.them.map((x) => row(x, false)).join("\n");
  return `With you:\n${ours}\n\nAgainst you:\n${theirs}`;
}

/**
 * Laid out once. The explorer keeps a session, so every turn after this one is a
 * single line and the standing of both sides.
 */
export function fightOpen(fight: FightT, me: FighterT, carried: Holding[] | null): string {
  const kit = (carried || [])
    .map((h) => `\n                    ${h.name} — ${does(h.effects)}`)
    .join("");
  return (
    "You are in a fight. It goes round by round, and this is your turn of it. " +
    "Every time you are asked, answer with one of these and nothing else:\n\n" +
    VERBS(me.weapon ?? "your hands", me.damage, kit) +
    "\n\nName who you are swinging at, or name nobody and you go for whoever is " +
    "closest to dropping.\n\n" +
    sides(fight) +
    "\n\nYou will be told what happened and asked again. One line, nothing else."
  );
}

/** What just happened, where everybody stands, and the question again. */
export function fightBlow(fight: FightT, me: FighterT, said: string): string {
  const hurt = me.health <= FLEE_FLOOR ? "\n\nYou are hurt badly." : "";
  return `${said}\n\n${sides(fight)}${hurt}\n\nWhat do you do?`;
}

export const ENDED: Record<NonNullable<FightT["ended"]>, string> = {
  beaten: "it went down.",
  fled: "you got out.",
  killed: "you did not get out.",
  broken: "it is not over.",
};

const BLOWS = (sheet: string, ended: string) =>
  `The fight has been rolled. They chose each of these, and this is what came of it, in order, and it is settled:

${sheet}

It ended: ${ended}

Write one line for each numbered blow, in that order, second person, present tense. One line is shown at a time, above the fight, and it changes as the fight moves — so each has to stand on its own, and none may lean on the one before it. A clause or a short sentence. This is a fight, not a chapter.

What they chose is theirs, not yours — narrate the choice they made, not the one you would have made for them. A landed blow lands and a missed one costs them. Do not soften a hit, do not add a blow, do not take one away, and do not say how it ends before the last line.

Never write the tallies out. The numbers are on the page beside your line, and a sentence ending "5 left in it" says twice what it is worth. Write what it looked like.

Reply in the same json shape you always use, with \`blows\` in place of \`narration\`:

    {"blows": ["…", "…"], "destination": "kebab-id",
     "transactions": [], "quest_open": [], "quest_update": [], "quest_close": []}

\`claims\` are not yours this time either — the record was checked when the fight was declared, and a blow is a particular, which nobody rules on. \`minutes\`, \`fatigue\`, \`health\`, \`check\` and \`fight\` are not yours this time — the fight already cost what it cost. \`transactions\` still are: what comes off a body, what breaks, what is dropped.`;

const FIGHT_FATE: Record<string, string> = {
  greater_calamity:
    "The dice also went hard against them, in the doing of this. Put it in the fight, in the blow it belongs to — the strap goes, the footing goes, something arrives. Do not soften it and do not undo a blow.",
  lesser_calamity:
    "The dice also went against them, in the doing of this. Put it in the fight, in the blow it belongs to — a fumble, a slip, a small hurt. It should sting, not maim. Do not add a blow and do not undo one.",
  lesser_fortune:
    "The dice favoured them a little, in the doing of this. Put it in the fight, in the blow it belongs to — a thing noticed, an opening, a stroke of ordinary luck. Do not add a blow and do not undo one.",
  greater_fortune:
    "The dice favoured them greatly, in the doing of this. Put it in the fight, in the blow it belongs to — a real find, a danger that passes them by. Let it matter. Do not add a blow and do not undo one.",
};

const FIGHT_DEATH = `It ended: you did not get out. They are dead. Before you reply, run:

    tesbota kill "<what killed them, in a phrase>"

The last line you write is the last line of their book. Write it as one.`;

function blowKind(blow: BlowT) {
  if (blow.chose === "ASLEEP") return "asleep";
  if (blow.who === ARRIVED) return "arrived";
  if (blow.spawned) return "spawned";
  if (blow.calling) return "calling";
  if (blow.side === "us" && blow.chose.startsWith("ITEM")) return "item";
  if (blow.chose === "FLEE") return "flee";
  return blow.hit ? "hit" : "miss";
}

/** One row of the roll sheet: who acted, what they chose, and what came of it. */
export function blowLine(blow: BlowT): string {
  const who = blow.name || "somebody";
  const said = blow.chose;
  const mark = blow.atname || "nobody";
  switch (blowKind(blow)) {
    case "asleep": return `${who} — does not stir`;
    case "arrived": return `${who} — arrive, answering ${said.replace(/^answers /, "")}`;
    case "spawned": return `${who} — ${said}, and ${blow.spawned} joins it`;
    case "calling": return `${who} — ${said}, calling ${blow.calling}`;
    case "item": return `${who} — ${said}, ${blow.mended || "nothing changed"}, ${blow.left} left of them`;
    case "flee": return blow.hit ? `${who} — broke away` : `${who} — tried to break away and could not`;
    case "hit": return `${who} — ${said} on ${mark}, landed, ${blow.dealt || blow.taken} off them, ${blow.left} left of them`;
    case "miss": return `${who} — ${said} on ${mark}, missed`;
  }
}

/** The one line the explorer is handed before being asked again. */
export function saidBlow(blow: BlowT): string {
  const who = blow.name || "somebody";
  const mark = blow.atname || "nobody";
  switch (blowKind(blow)) {
    case "asleep": return `${who} does not stir.`;
    case "arrived": return `${who} ${who.includes(", ") ? "arrive" : "arrives"}.`;
    case "spawned": return `${who} ${blow.chose} — ${blow.spawned} is on you as well.`;
    case "calling": return `${who} calls for ${blow.calling}.`;
    case "item": return `${who} used the ${blow.chose.slice(5)}.`;
    case "flee": return blow.hit ? `${who} broke away.` : `${who} tried to break away and could not.`;
    case "hit": return `${who} hit ${mark} for ${blow.dealt || blow.taken}.`;
    case "miss": return `${who} swung at ${mark} and missed.`;
  }
}

export function gmBlows(fight: FightT, fate: string | null): string {
  const sheet: string[] = [];
  let seen: unknown = null;
  for (const b of fight.blows) {
    if (b.round !== seen) {
      seen = b.round;
      sheet.push(`  round ${seen}`);
    }
    sheet.push(`    ${b.n}  ${blowLine(b)}`);
  }
  const parts = [BLOWS(sheet.join("\n"), fight.ended ? ENDED[fight.ended] : "it is not over.")];
  if (fate && FIGHT_FATE[fate]) parts.push(FIGHT_FATE[fate]);
  if (fight.ended === "killed") parts.push(FIGHT_DEATH);
  return parts.join("\n\n");
}

export const REDRAFT =
  "Your previous draft was rejected. Revise it and reply with the same json shape. " +
  "Keep everything that still stands — a redraft is a correction, not a retreat, " +
  "and an answer that says less than the one before it is a worse answer, not a " +
  "safer one:\n\n";

export function gmAnswer(
  question: string,
  { previous = null, mode = "look", inventory = null, others = null, correction = null, load = null, sent = null }:
  { previous?: string | null; mode?: string; inventory?: Holding[] | null; others?: Keeps | null;
    correction?: string | null; load?: Load | null; sent?: Record<string, string> | null } = {}
): string {
  const parts: string[] = [];
  if (previous) parts.push(lastTold(previous));
  kitBlocks(parts, sent, { inventory, load, others });

  if (mode === "say") {
    parts.push(
      "They are speaking. Nothing else is happening and they have not committed " +
        `to any action. They say:\n\n${question}\n\n` +
        "Answer as whoever they are talking to would, in that person's voice, and " +
        "narrate nothing but the reply and how it is given. Nobody moves and no " +
        "bargain is struck by talking about it. If they are speaking to no one, " +
        "say so. A sentence or two."
    );
  } else {
    parts.push(
      "They are not doing anything yet — they are looking harder at what is " +
        `already in front of them, and they ask:\n\n${question}\n\n` +
        "Answer only what can be perceived from where they stand. No time passes " +
        "and nothing is done. Do not offer choices, do not move them, and do not " +
        "introduce anything that would not simply be visible from here. A sentence " +
        "or two."
    );
  }
  parts.push("Reply in the same json shape, with minutes 0 and fatigue 0.");
  if (correction) parts.push(REDRAFT + correction);
  return parts.join("\n\n");
}

const REJECTED = "Your previous draft was rejected. Revise it and reply with the same json shape:\n\n";

export const PRESS = `The world does not wait, and this turn it moves.

Something that was going on without the adventurer arrives. Somebody acts, something waiting stops waiting, a thread already on the table pays out — the person they were warned about finds them, the errand turns out to have been a pretext, what was in the trees comes out of the trees.

Use what is already there: an open quest, a name somebody let slip, a warning they walked past. Do not start a fresh mystery — move the one they are standing in.

It happens whether or not their action invited it, it costs them something or demands an answer, and nobody warns them first. Not luck and not weather; the dice handle those. Somebody in the world doing something on purpose. Narrate it as part of the same turn, after what they did.`;

const CHOSEN = (text: string) =>
  `This is how the action turns out. It was rolled for, out of six ways it could have gone, and this is the one that came up:

    ${text}

Narrate it as what happens. Do not hedge it, do not offer it as a possibility, and do not mention that anything was rolled. Keep the rest of the turn as it was; this replaces the outcome, not the action.`;

export const STRANGE =
  "This one is strange, and that is deliberate. Put it in front of them plainly and without explanation. Nobody in the scene remarks on it, nothing accounts for it, and you do not hint at what it means — you do not know. Write it as a claim like any other and let it be ruled on.";

export function gmTurn(
  action: string | null | undefined,
  { previous = null, vitals = null, correction = null, journey = null,
    agreed = null, note = null, chosen = null, press = false, inventory = null, others = null,
    quests = null, now = null, load = null, sent = null, carried = null }:
  { previous?: string | null; vitals?: VitalsT | null; correction?: string | null;
    journey?: JourneyT | null; agreed?: ProposalT | null; note?: string | null;
    chosen?: OutcomeT | null; press?: boolean;
    inventory?: Holding[] | null; others?: Keeps | null; quests?: QuestT[] | null;
    now?: string | null; load?: Load | null; sent?: Record<string, string> | null;
    carried?: CarriedT | null } = {}
): string {
  const parts: string[] = [];
  if (now) parts.push(`The time is ${now}.`);
  if (note) parts.push(noteBlock(note));
  if (agreed) {
    parts.push(
      "They agreed to this, and it is settled — narrate it as happening, " +
        `and do not re-price it:\n\n${agreed.summary}\n\n` +
        `It takes ${agreed.minutes} minutes and costs ${agreed.fatigue} fatigue. ` +
        "If it sends them somewhere, set `destination` and narrate them setting off, " +
        "never arriving; the walk is not in these minutes."
    );
  }
  if (vitals) parts.push(vitalsBlock(vitals));
  if (previous) parts.push(lastTold(previous));
  if (journey && !journey.cut) {
    parts.push(`The adventurer has arrived at ${journey.to}. Narrate the arrival.`);
  }
  if (journey?.cut) {
    parts.push(
      "Something interrupts the journey here. Invent what, and narrate it. " +
        "The adventurer has been travelling and does not know how long. " +
        `They were on their way to ${journey.to}, and the road still has ${journey.left} ` +
        `leagues in it: when they are done here, set \`destination\` to \`${journey.to}\` ` +
        "and they carry on from where they stopped."
    );
  }
  kitBlocks(parts, sent, { inventory, load, others, quests });
  if (carried) {
    const left = carried.them.filter((x) => !x.dead).map((x) => `${x.name}, ${x.health} left`).join("; ");
    parts.push(
      `The fight with ${carried.name} is not over: ${left}. ` +
        "Declare it again with that health to carry the pool forward, or " +
        "narrate it ending some other way and leave `fight` out."
    );
  }
  if (action) parts.push(`The adventurer's action:\n\n${action}`);
  if (press) parts.push(PRESS);
  if (chosen) {
    parts.push(CHOSEN(chosen.text));
    if (["epic", "legendary"].includes(chosen.band)) parts.push(STRANGE);
  }
  if (correction) parts.push(REJECTED + correction);
  return parts.join("\n\n");
}

export function gmPropose(
  action: string | null | undefined,
  { previous = null, vitals = null, answers = null, note = null, inventory = null,
    others = null, now = null, load = null }:
  { previous?: string | null; vitals?: VitalsT | null; answers?: Array<[string, string]> | null;
    note?: string | null; inventory?: Holding[] | null; others?: Keeps | null;
    now?: string | null; load?: Load | null } = {}
): string {
  const parts: string[] = [];
  if (now) parts.push(`The time is ${now}.`);
  if (note) parts.push(noteBlock(note));
  if (previous) parts.push(lastTold(previous));
  if (vitals) parts.push(vitalsBlock(vitals));
  kitBlocks(parts, null, { inventory, load, others });
  parts.push(`What they intend to do:\n\n${action}`);
  for (const [question, answer] of answers || []) {
    parts.push(`You asked: ${question}\n\nThe record says: ${answer}`);
  }
  return parts.join("\n\n");
}

const named = (where: PlacedT[]) =>
  where
    .map((w) => w.name || w.id)
    .filter(Boolean)
    .join(" > ");

/**
 * Everything the game master did besides narrate.
 *
 * A turn comes back as prose and as a block of structured fields beside it, and
 * for a long time only the prose was ever ruled on — so a place could be invented,
 * an item could change hands and an errand could be taken on without any of it
 * passing a lore master. The fields say as much about the world as the sentences
 * do, so they are read out here in plain words and go the same way.
 */
export function doings(draft: DraftT | null | undefined, here?: string | null): string {
  if (!draft) return "";
  const said: string[] = [];

  const heading = draft.destination?.trim() ?? "";
  if (heading && heading !== here) said.push(`They are heading for: ${heading}`);
  for (const t of draft.transactions) {
    if (!t.name) continue;
    const from = t.from !== "the-godhead" ? t.from : "the world";
    const to = t.to !== "the-godhead" ? t.to : "the world";
    const many = Math.abs(t.qty || 1);
    said.push(`${many} ${t.name} passed from ${from} to ${to}`);
  }
  for (const item of draft.quest_open) {
    const q = Written.safeParse(item).data;
    if (!q?.title && !q?.id) continue;
    said.push(`They have taken on: ${q.title || q.id}` + (q.giver ? `, set by ${q.giver}` : ""));
  }
  for (const q of draft.quest_close) {
    const id = q && typeof q === "object" ? Written.safeParse(q).data?.id : q;
    if (id) said.push(`An errand is finished: ${id}`);
  }
  return said.map((x) => `- ${x}`).join("\n");
}

export function lore1Turn(
  narration: string,
  { where = null, now = null, roster = null, did = null }:
  { where?: PlacedT[] | null; now?: string | null; roster?: string | null; did?: string | null } = {}
): string {
  const parts: string[] = [];
  if (where) parts.push("Where: " + named(where));
  if (now) parts.push(`When: ${now}`);
  parts.push(`What the game master narrated:\n\n${narration}`);
  if (roster) {
    parts.push(
      "A fight is being declared, and these are the bodies it puts on the " +
        "ground. They are as much of an assertion as the sentences are — take " +
        "the kinds and the capabilities out of them too:\n\n" + roster
    );
  }
  if (did) {
    parts.push(
      "It also did these, beside the words. They assert as much as the sentences " +
        "do — where somebody now is, what changed hands, what was taken on — so " +
        "read the world out of them too:\n\n" + did
    );
  }
  parts.push("Write down what it asserts about the world.");
  return parts.join("\n\n");
}

export function musterLine(who: FighterT): string {
  const bits = [who.name || "somebody"];
  if (who.most) bits.push(`${who.most} health`);
  if (who.damage) bits.push(`${who.damage} damage`);
  if (who.defense) bits.push(`${who.defense} defense`);
  const power = who.ability;
  if (power?.name) {
    const said = [power.name];
    if (power.damage) said.push(`${power.damage} damage`);
    const called = power.spawn?.name;
    if (called) said.push(`calls in ${called}`);
    bits.push("can " + said.join(", "));
  }
  return "- " + bits.join(", ");
}

export function muster(fight: FightT): string {
  const out: string[] = [];
  for (const [side, label] of [["them", "Against them"], ["us", "With them"]] as const) {
    const bodies = fight[side].filter((x) => x.kind !== "explorer");
    if (bodies.length) out.push(label + ":\n" + bodies.map(musterLine).join("\n"));
  }
  return out.join("\n\n");
}

export function lore2Turn(
  narration: string, facts: string[], unknown?: Array<{ id: string; name: string }> | null
): string {
  const listed = facts.map((f) => `- ${f}`).join("\n") || "- (nothing was read out of it)";
  const parts = [
    `What the game master narrated:\n\n${narration}`,
    `What it asserts about the world:\n${listed}`,
  ];
  if (unknown?.length) {
    const named_ = unknown.map((x) => `- \`${x.id}\`, written as "${x.name}"`).join("\n");
    parts.push(
      "A fight is being declared, and these bodies in it have no row in the " +
        "world:\n\n" + named_ + "\n\nSay what each one is. Look for what the " +
        "world already keeps for fighting and bind it to that where it is the " +
        "same kind of thing under another name — a mill rat is a rat. Bind " +
        "nothing across a kind: if the world has no such creature at all, leave " +
        "`is` empty and ask whether it exists. Answer in `bodies`."
    );
  }
  parts.push("Rule on each.");
  return parts.join("\n\n");
}

export const lore3Turn = (gap: string) =>
  "The world is silent on the following, and the silence needs to end:\n\n" +
  `${gap}\n\n` +
  "Talk it through with me first. Look up whatever already exists before " +
  "proposing anything. When we agree, write the documents.";

export function questmasterTurn(quest: QuestT, where?: PlacedT[] | null): string {
  const parts = [`The errand: ${quest.title}`];
  if (quest.detail) parts.push(`As it was put to them: ${quest.detail}`);
  if (quest.giver) parts.push(`Set by: ${quest.giver}`);
  if (where) parts.push("Taken on at: " + named(where));
  parts.push("Read what the world already says about any of this, then write the script.");
  return parts.join("\n\n");
}

export const LAYERS: ReadonlyArray<readonly [string, string]> = [
  ["common", "common"],
  ["writing", "writing"],
  ...new Map(Object.values(AGENTS).map((a) => [a.prompt, a.label])),
];

/**
 * Every prompt as it is written on disk — the shared blocks stay a pointer to the
 * tab that holds them rather than repeated under each agent.
 */
export function catalogue() {
  return LAYERS.map(([key, label]) => {
    const raw = fs.readFileSync(path.join(PROMPTS, `${key}.md`), "utf8");
    return { id: key, label, text: fill(raw), source: raw };
  });
}
