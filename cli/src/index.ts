#!/usr/bin/env node
/**
 * The command line. The web steers the world through this and nothing else, so
 * every command that changes anything prints one line of json last — which is the
 * whole of the contract between the two halves.
 */

import * as actions from "./actions.ts";
import * as canon from "./canon.ts";
import { check } from "./check.ts";
import * as chronicle from "./chronicle.ts";
import * as db from "./db.ts";
import * as driver from "./driver.ts";
import * as machine from "./machine.ts";
import * as mapping from "./mapping.ts";
import * as prompts from "./prompts.ts";
import * as sheet from "./sheet.ts";
import * as sky from "./sky.ts";
import { reachable } from "./sqlite.ts";
import * as view from "./view.ts";
import * as worldclock from "./worldclock.ts";
import {
  APPAREL_ICON, EXPLORER, FIRST_NAMES, ITEM_TYPES, PLACE_TYPES, PROFILE, RARITY,
  STARTING_INVENTORY, SURNAME, TRAITS,
} from "./config.ts";
import {
  allTurns, campaignIfAny, catalogue, ensureLayout, explorerName, loadCampaign,
  loadTurn, now, parse, saveCampaign, stock,
} from "./state.ts";

const say = (x: unknown) => console.log(typeof x === "string" ? x : JSON.stringify(x));

type Args = { flags: Set<string>; rest: string[] };

const COMMANDS: Record<string, (a: Args) => Promise<void> | void> = {
  async init() {
    ensureLayout();
    db.setup();
    chronicle.ensureBook();
    const campaign = loadCampaign();
    if (canon.holdings(EXPLORER).length) catalogue(STARTING_INVENTORY as any);
    else stock(STARTING_INVENTORY as any);
    if (campaign.current_turn) {
      say(`already initialised — turn ${campaign.current_turn}`);
      return;
    }
    const turn = await driver.openWorld(campaign);
    say(`tesbota initialised. ${turn.turn_id}:`);
    say("");
    say(view.wrap((turn as any).draft?.narration));
  },

  async step({ flags }) {
    if (flags.has("--json")) return say(await actions.step());
    const ran = await driver.run(1);
    const turn = ran.turn;
    if (ran.state === "arbiter") {
      say(`[${turn.turn_id}] the world is silent. run: tesbota lore`);
      say("");
      say(String(turn.gap ?? "").trim());
    } else if (ran.state === "clock") {
      const left = parse(String(turn.wake_at)).getTime() - now().getTime();
      say(`[${turn.turn_id}] travelling to ${(turn as any).destination} — ${Math.max(0, Math.floor(left / 60000))} min to go`);
    } else {
      say(`[${turn.turn_id}] ${ran.state}`);
      const narration = loadCampaign().last_narration;
      if (narration) {
        say("");
        say(view.wrap(narration));
      }
    }
  },

  /** Turn the world over on its own until it is paused, blocked or stopped. */
  async play({ rest }) {
    const every = Number(rest[0]) || 5;
    for (;;) {
      const campaign = loadCampaign();
      if (campaign.paused) {
        await new Promise((r) => setTimeout(r, every * 1000));
        continue;
      }
      let ran: driver.Ran;
      try {
        ran = await driver.run(1);
      } catch (exc) {
        // An agent that will not answer in json is not a reason to lose the world.
        // It is written down and the loop waits, rather than the process dying.
        say(`[${loadCampaign().current_turn}] stumbled: ${(exc as Error).message}`.slice(0, 400));
        await new Promise((r) => setTimeout(r, every * 1000));
        continue;
      }
      say(`[${ran.turn.turn_id}] ${ran.state}`);
      if (ran.state === "arbiter") return;
      await new Promise((r) => setTimeout(r, every * 1000));
    }
  },

  /** The system, solved. `--seed` lays the starting sky down where it is missing. */
  sky({ flags }) {
    if (flags.has("--seed")) {
      const written = sky.seed();
      if (flags.has("--json")) return say({ seeded: written });
      say(written.length ? `wrote the sky for ${written.join(", ")}` : "the sky was already written");
    }
    const said = sky.describe();
    if (flags.has("--json")) return say(said);

    const hours = (seconds: number | null) =>
      seconds ? `${(seconds / 3600).toFixed(4)} h` : "—";
    for (const [id, it] of Object.entries(said.bodies) as Array<[string, any]>) {
      say(`${view.BOLD}${it.name}${view.OFF}${view.DIM} — ${id}${view.OFF}`);
      if (it.around) say(`  goes round ${it.around}`);
      if (it.semiMajor) {
        say(`  ${(it.semiMajor / 1e9).toFixed(3)} million km out, eccentricity ${it.eccentricity}`);
      }
      if (it.mass) say(`  ${it.mass.toExponential(4)} kg`);
      if (it.radius) say(`  ${(it.radius / 1000).toFixed(0)} km across the equator, oblateness ${it.oblateness}`);
      if (it.tilt) say(`  leans ${it.tilt}°`);
      if (it.rotation) say(`  turns once in ${hours(it.rotation)}, and faces its primary again after ${hours(it.solar_day)}`);
      if (it.days_per_year) say(`  a year is ${it.days_per_year.toFixed(3)} of its days`);
      say("");
    }
    const { days, derived } = said.calendar;
    say(`${derived ? "solved" : "declared"}: ${days} days to the year`);
  },

  status() {
    const campaign = loadCampaign();
    if (!campaign.current_turn) return say("no campaign yet. run: tesbota init");
    say(view.renderStatus(campaign, loadTurn(campaign.current_turn)));
  },

  log({ flags, rest }) {
    const campaign = loadCampaign();
    let turns = allTurns();
    const seen = campaign.last_seen;
    if (flags.has("--new")) turns = turns.filter((t) => !seen || t.turn_id > seen);
    else if (Number(rest[0])) turns = turns.slice(-Number(rest[0]));
    if (!turns.length) return say("nothing has happened yet");
    say(view.renderLog(turns, seen));
    campaign.last_seen = turns[turns.length - 1].turn_id;
    saveCampaign(campaign);
  },

  async say({ rest }) {
    say(await actions.say(rest.join(" ")));
  },

  async talk({ rest }) {
    say(await actions.talk(rest.join(" ")));
  },

  async resolve() {
    say(await actions.resolve());
  },

  note({ rest }) {
    say(actions.setNote(rest.join(" ")));
  },

  pause({ flags, rest }) {
    const asked = rest[0];
    const result = asked === undefined
      ? { ok: true, paused: !!loadCampaign().paused }
      : actions.pause(asked === "on");
    if (flags.has("--json")) return say(result);
    say(result.paused ? "the world is paused" : "the world is running");
  },

  speed({ flags, rest }) {
    if (rest[0] === undefined) {
      const speed = (loadCampaign().clock as any)?.speed_factor ?? null;
      return say(flags.has("--json") ? { ok: true, speed } : `speed ${speed}`);
    }
    const result = actions.setSpeed(rest[0]);
    say(flags.has("--json") ? result : `speed ${result.speed}`);
  },

  kill({ flags, rest }) {
    const result = actions.kill(rest.join(" ") || null);
    say(flags.has("--json") ? result : result.cause);
  },

  stats() {
    say(sheet.renderStats());
  },

  inventory() {
    say(sheet.renderInventory());
  },

  holdings({ rest }) {
    say(sheet.renderHoldings(rest[0] || null));
  },

  quests() {
    say(sheet.renderQuestLog());
  },

  time() {
    const campaign = loadCampaign();
    const t = campaign.time as any;
    say(`${worldclock.longStamp(t)}  (${worldclock.partOfDay(t)})`);
  },

  chronicle() {
    const written = chronicle.passages();
    if (!written.length) return say("the narrator has not written anything yet");
    for (const p of written) {
      say(view.wrap(canon.plain(p.text)));
      say("");
    }
  },

  traits({ rest }) {
    say(rest[0] ? canon.traits(rest[0], true).join(", ") : canon.rollTraits().join(", "));
  },

  library() {
    for (const book of canon.library()) {
      say(`${book.name} — ${book.author}${book.written ? `, ${book.written}` : ""}`);
    }
  },

  map({ flags }) {
    if (flags.has("--json")) return say(mapping.layout());
    say(canon.mermaid());
  },

  prompts({ flags }) {
    const found = prompts.catalogue();
    if (flags.has("--json")) return say(found);
    for (const layer of found) {
      say(`── ${layer.label} ──`);
      say(layer.text);
      say("");
    }
  },

  /** Everything that has to be true before the machine is trusted to run. */
  check({ flags }) {
    const wrong = check();
    if (flags.has("--json")) return say({ ok: !wrong.length, wrong });
    if (!wrong.length) return say("all clear");
    for (const w of wrong) say(`  ${w.what}: ${w.said}`);
    say("");
    say(`${wrong.length} wrong`);
    process.exitCode = 1;
  },

  /** The machine describing itself — what the dev tab draws. */
  machine({ flags }) {
    const wrong = machine.audit();
    if (flags.has("--json")) return say({ ...machine.describe(), wrong });
    const { states, edges } = machine.describe();
    say(`${states.length} states, ${edges.length} edges`);
    for (const e of edges) say(`  ${e.from} --${e.on}--> ${e.to}   (${e.when})`);
    if (wrong.length) {
      say("");
      for (const w of wrong) say(`  wrong: ${w}`);
      process.exitCode = 1;
    }
  },

  data({ flags }) {
    const taken = canon.givenNames();
    const payload = {
      names: {
        surname: SURNAME,
        current: explorerName(),
        pool: FIRST_NAMES.map((n) => ({ name: n, taken: taken.has(n.toLowerCase()) })),
      },
      personality: TRAITS.map(([trait, rarity]) => ({ trait, rarity })),
      rarity: RARITY.map(([rarity, weight]) => ({ rarity, weight })),
      kit: (STARTING_INVENTORY as readonly any[]).map((entry) => ({
        ...entry,
        id: canon.slug(entry.name),
        slot: entry.slot ?? null,
        effect: canon.does(entry.effects),
      })),
      places: PLACE_TYPES.map(([type, what, icon]) => ({ type, what, icon })),
      items: ITEM_TYPES.map(([type, stats, icon, slots]) => ({
        type, stats, icon,
        slots: slots.map((s) => ({ slot: s, icon: APPAREL_ICON[s] ?? icon })),
      })),
      mobs: canon.mobs(),
      machine: machine.describe(),
    };
    if (flags.has("--json")) return say(payload);
    say(JSON.stringify(payload, null, 2));
  },
};

/**
 * `init` is the only thing that brings a world into being. Everything else either
 * needs one already or does not care — and the ones that need one must say so
 * rather than quietly minting an adventurer to answer with, which is what reading
 * an empty profile used to do.
 */
const MAKES = "init";
const NEEDS_NOBODY = new Set(["machine", "check", "prompts", "library", "map", "traits", "sky"]);

async function main() {
  // Before anything is asked of an agent, make sure the one command it reads the
  // world with is on the PATH it will inherit.
  reachable();
  const [, , command, ...argv] = process.argv;
  if (!command || command === "--help" || command === "-h") {
    say(`tesbota — ${Object.keys(COMMANDS).sort().join(", ")}`);
    return;
  }
  const run = COMMANDS[command];
  if (!run) {
    say(`no such command: ${command}`);
    process.exitCode = 2;
    return;
  }
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const rest = argv.filter((a) => !a.startsWith("--"));

  if (command !== MAKES && !NEEDS_NOBODY.has(command) && !campaignIfAny()) {
    const said = { error: `no world in ${PROFILE} yet — run: tesbota init` };
    say(flags.has("--json") ? said : said.error);
    process.exitCode = 3;
    return;
  }

  await run({ flags, rest });
}

main().catch((exc) => {
  console.error(String((exc as Error)?.stack || exc));
  process.exitCode = 1;
});
