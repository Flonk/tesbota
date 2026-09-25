/** Every number the world runs on, in one place, the way `tesbota/config.py` held them. */

import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const CANON = path.join(ROOT, "canon");
export const CANON_DB = process.env.TESBOTA_CANON || path.join(ROOT, "canon.db");

export const PROFILES = ["corda", "debug"] as const;
export type Profile = (typeof PROFILES)[number];

const asked = (process.env.TESBOTA_PROFILE || "").trim().toLowerCase();
export const PROFILE: Profile = (PROFILES as readonly string[]).includes(asked)
  ? (asked as Profile)
  : PROFILES[0];

// One world, more than one adventurer walking it. The first keeps the state
// directory it has always had; anybody else gets a room of their own inside it.
export const SHARED = path.join(ROOT, "state");
export const roomOf = (p: Profile) => (p === PROFILES[0] ? SHARED : path.join(SHARED, p));
export const STATE = roomOf(PROFILE);

export const TURNS = path.join(STATE, "turns");
export const PENDING = path.join(ROOT, "pending");
export const CAMPAIGN = path.join(STATE, "campaign.json");
export const DEATH = path.join(STATE, "death.json");

export const KINDS = ["people", "places", "books", "items", "aspects", "abilities"] as const;

export const READ_TOOLS = ["Bash"];
export const WRITE_TOOLS = ["Bash"];

export const MAX_GM_RETRIES = 3;

// Defense does not subtract from a blow, it divides it — a body with DEFENSE_HALVES
// takes half of what lands, twice that takes a third, and nothing is ever immune.
export const DEFENSE_HALVES = 100;

// A fight is one turn of the world, played out blow by blow. The explorer picks each
// one; the driver rolls it and pays for it.
export const MAX_BLOWS = 300;
export const FLEE_FLOOR = 25;
export const BLOW_MINUTES = 1;
export const BLOW_FATIGUE = 3;
export const UNARMED = "1–2";

export const MODEL = "claude-sonnet-5";
export const MODELS: Record<string, string> = {
  explorer: MODEL, gm: MODEL, lore1: MODEL, lore2: MODEL, lore3: MODEL, lore4: "claude-opus-5-5",
  questmaster: "claude-opus-5-5",
};

export const GODHEAD = "the godhead";
export const GODHEAD_ID = "the-godhead";
export const NARRATOR = "The Narrator";
export const GODHEADS = [GODHEAD, NARRATOR.toLowerCase()];

export const TRAITS: ReadonlyArray<readonly [string, string]> = [
  ["blunt", "common"], ["patient", "common"], ["curious", "common"],
  ["wary", "common"], ["stubborn", "common"], ["generous", "common"],
  ["thrifty", "common"], ["proud", "common"], ["anxious", "common"],
  ["loyal", "common"], ["idle", "common"], ["industrious", "common"],
  ["cheerful", "common"], ["sullen", "common"], ["talkative", "common"],
  ["quiet", "common"], ["pious", "common"], ["superstitious", "common"],
  ["practical", "common"], ["sentimental", "common"], ["hot-tempered", "common"],
  ["even-tempered", "common"], ["nosy", "common"], ["private", "common"],
  ["boastful", "common"], ["self-effacing", "common"], ["greedy", "common"],
  ["hospitable", "common"], ["suspicious", "common"], ["tender", "common"],
  ["self-critical", "common"], ["quick to laugh", "common"],
  ["slow to forgive", "common"], ["solemn", "common"], ["restless", "common"],
  ["steady", "common"], ["bawdy", "common"], ["prim", "common"],
  ["sharp-tongued", "common"], ["deferential", "common"],

  ["vain", "uncommon"], ["cowardly", "uncommon"], ["reckless", "uncommon"],
  ["vengeful", "uncommon"], ["forgiving to a fault", "uncommon"],
  ["cannot lie", "uncommon"], ["lies for no reason", "uncommon"],
  ["bitter", "uncommon"], ["fatalistic", "uncommon"], ["zealous", "uncommon"],
  ["contrarian", "uncommon"], ["credulous", "uncommon"], ["cynical", "uncommon"],
  ["possessive", "uncommon"], ["jealous", "uncommon"], ["meddling", "uncommon"],
  ["imperious", "uncommon"], ["servile", "uncommon"], ["morbid", "uncommon"],
  ["dreamy", "uncommon"], ["pedantic", "uncommon"], ["miserly", "uncommon"],
  ["profligate", "uncommon"], ["flirtatious", "uncommon"], ["prudish", "uncommon"],
  ["gullible about people", "uncommon"], ["unmoved by suffering", "uncommon"],
  ["easily shamed", "uncommon"], ["shameless", "uncommon"],
  ["incurious about anything new", "uncommon"],

  ["cruel", "epic"], ["fearless", "epic"], ["saintly", "epic"],
  ["incapable of anger", "rare"], ["incapable of stillness", "rare"],
  ["delights in ruin", "epic"], ["trusts nobody", "rare"],
  ["trusts everybody", "rare"], ["cannot feel fear", "epic"],
  ["laughs at the wrong moments", "epic"], ["weeps easily and without cause", "epic"],
  ["never sleeps a full night", "epic"], ["forgets faces", "rare"],

  ["autism", "legendary"], ["bipolar disorder", "legendary"],
  ["mania", "legendary"], ["schizophrenia", "legendary"],
  ["paranoia", "legendary"], ["melancholia", "legendary"],
  ["obsessive-compulsive disorder", "legendary"],
  ["multiple personality disorder", "legendary"],
  ["psychopathy", "legendary"], ["narcissistic personality disorder", "legendary"],
  ["selective mutism", "legendary"], ["alexithymia", "legendary"],
  ["auditory hallucinations", "legendary"], ["synesthesia", "legendary"],
  ["hyperthymesia", "legendary"], ["prosopagnosia", "legendary"],
  ["catatonia", "legendary"], ["kleptomania", "legendary"],
];

export const RARITY: ReadonlyArray<readonly [string, number]> = [
  ["common", 0.62],
  ["uncommon", 0.27],
  ["rare", 0.098],
  ["epic", 0.01],
  ["legendary", 0.002],
  ["unique", 0.0],
];
export const WEIGHT: Record<string, number> = Object.fromEntries(RARITY);
export const RARITIES = RARITY.map(([name]) => name);

export const TRAITS_ROLLED = 3;

export const SURNAME = "Bota";

export const MYSTERY = "died of a mysterious cause";

export const FIRST_NAMES = [
  "Ansel", "Arndt", "Bastian", "Berta", "Bram", "Clemens", "Corda", "Detlev",
  "Edda", "Eike", "Elsbet", "Everd", "Frauke", "Gerd", "Gesa", "Gunda",
  "Hanne", "Harm", "Heike", "Hilke", "Ilse", "Immo", "Jelle", "Joost",
  "Karsten", "Katrin", "Klaas", "Lene", "Levke", "Lubbert", "Maren", "Meike",
  "Menno", "Mette", "Nanne", "Neele", "Onno", "Otte", "Rike", "Roelof",
  "Sanne", "Sibbe", "Sieger", "Silke", "Sonke", "Swantje", "Tammo", "Telse",
  "Thies", "Tomke", "Ubbo", "Uwe", "Vibeke", "Volkert", "Wibke", "Wiard",
  "Wilke", "Wobke", "Ynse", "Zwaantje",
];

export const STUB = "$BOTA";

// One world, and a holder for each adventurer walking it. The first keeps the plain
// name; anybody else is told apart by their profile, so two kits never become one.
export const EXPLORERS: Record<Profile, string> = Object.fromEntries(
  PROFILES.map((p) => [p, p === PROFILES[0] ? "the-explorer" : `the-explorer-${p}`])
) as Record<Profile, string>;
export const EXPLORER = EXPLORERS[PROFILE];

export const FORBIDDEN_AUTHORS = ["the explorer", "the adventurer", "explorer", "adventurer"];

export const OPENING = {
  narration:
    "You are standing on a road in wet grass. Fog stands close on every side, " +
    "and the road runs away from you in two directions. " +
    "You should probably keep walking.",
  claims: [
    { id: "o1", text: "A road runs through wet grass.", entity: "flotburg-trail", kind: "places" },
    { id: "o2", text: "Fog stands close around the road on every side, hiding what lies beyond.", entity: "flotburg-trail", kind: "places" },
    { id: "o3", text: "The road runs away in two directions.", entity: "flotburg-trail", kind: "places" },
  ],
  destination: "flotburg-trail",
  minutes: 0,
  fatigue: 0,
  health: 0,
};

/**
 * What every new life is set walking toward. The script is the game master's
 * alone: a direction to play toward, not a railroad.
 */
export const OPENING_QUEST = {
  id: "where-am-i",
  title: "Where Am I?",
  detail: "",
  script: "Nudge the explorer towards Alheim. Make them fight a rat along the way.",
};

export const DAYS_PER_WEEK = 7;
export const WEEKS_PER_MONTH = 4;
export const MONTHS_PER_YEAR = 8;
export const DAYS_PER_MONTH = DAYS_PER_WEEK * WEEKS_PER_MONTH;
export const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR;

export const MONTH_NAMES = [
  "Frostfall", "Deepfrost", "Frostbreak", "Seedwake",
  "Longlight", "Highsun", "Reaptide", "Emberwane",
];

export const DAY_NAMES = [
  "Firstday", "Millday", "Waterday", "Midweek", "Marketday", "Restday", "Lastday",
];

export const WORLD_START = { era: 4, year: 202, day: 1, minute: 13 * 60 + 4 };

/**
 * The sky the world starts with, which is only a floor — lore may move any of it
 * and the calendar follows, because nothing about a year is written down twice.
 *
 * These numbers are not decorative. They are chosen to give back exactly the
 * calendar above: a 24-hour solar day and a 224-day year, so every stamp already
 * set down in a book still reads the same after the sky is solved rather than
 * declared. `tesbota check` will not let that drift.
 *
 * Everything goes round the middle of the system it sits in. Terra does not go
 * round Sol: Terra SOI does, round the middle of the Solar System, and Terra sits
 * at the middle of its own reach with whatever goes round it.
 */
export const WORLD_SKY = {
  sol: { mass: 1.98892e30, radius: 6.957e8, rotation: 2192832 },
  "terra-soi": {
    semi_major: 107993108578,
    eccentricity: 0.0167,
    // Midwinter falls in the middle of Deepfrost and midsummer in the middle of
    // Highsun, which is what the month names have been claiming all along.
    longitude: 204.107142857143,
    periapsis: 270,
  },
  terra: {
    mass: 5.972e24,
    radius: 6371000,
    oblateness: 0.0033528,
    tilt: 23.4,
    rotation: 86016,
    meridian: 0,
  },
} as const;

export const SPEED_FACTOR = 10;

export const CARRY_PER_STR = 0.5;
export const OVER_DRAG = 10.0;
export const MAX_HEALTH = 100;
export const MAX_FATIGUE = 100;
export const MAX_HUNGER = 100;

export const HUNGER_PER_HOUR = 4;

export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;

export const SKILL_ABILITY: Record<string, string> = {
  "acrobatics": "dex",
  "animal handling": "wis",
  "arcana": "int",
  "athletics": "str",
  "deception": "cha",
  "history": "int",
  "insight": "wis",
  "intimidation": "cha",
  "investigation": "int",
  "medicine": "wis",
  "nature": "int",
  "perception": "wis",
  "performance": "cha",
  "persuasion": "cha",
  "religion": "int",
  "sleight of hand": "dex",
  "stealth": "dex",
  "survival": "wis",
};

export const STARTING_SKILLS = {
  abilities: { str: 10, dex: 11, con: 12, int: 11, wis: 12, cha: 9 } as Record<string, number>,
  proficiency: 2,
  proficient: ["perception", "survival"],
};

export const SKILL_DIE = 20;

export const SLOTS = ["helmet", "chest", "legs", "feet", "mainhand", "offhand", "ring"] as const;

export const RING_SLOTS = 4;

export const APPAREL_ICON: Record<string, string> = {
  helmet: "helm",
  chest: "shirt",
  legs: "trousers",
  feet: "boot",
  offhand: "shield",
  ring: "ring",
};

export const PLACE_TYPES: ReadonlyArray<readonly [string, string, string]> = [
  ["location", "somewhere you can stand: a town, a house, a bridge", "pin"],
  ["region", "an expanse with places inside it: a forest, a marsh, a plain", "map"],
  ["road", "a way somebody made, and the run of it", "map"],
  ["river", "running water, and the length of it", "river"],
  ["water", "water with a shore: a sea, a lake, a bay", "river"],
  ["celestial-body", "a world, a moon, a sun", "world"],
  ["celestial-system", "bodies bound to each other, and the space between them", "orbit"],
  ["realm", "a universe, and everything any of this hangs inside", "realm"],
];

export const ITEM_TYPES: ReadonlyArray<readonly [string, string, string, readonly string[]]> = [
  ["weapon", "damage", "sword", ["mainhand", "offhand"]],
  ["apparel", "defense", "shirt", ["helmet", "chest", "legs", "feet", "offhand", "ring"]],
  ["consumable", "health, hunger", "flask", []],
  ["tool", "what it lets them do", "hammer", []],
  ["valuable", "worth, to whom, and who owes it", "coin", []],
  ["material", "—", "sack", []],
];

export const STARTING_INVENTORY = [
  { name: "Explorer's Cap", type: "apparel", qty: 1, worn: true, slot: "helmet", weight: 0.1, rarity: "uncommon" },
  { name: "Linen Shirt", type: "apparel", qty: 1, worn: true, slot: "chest", effects: { defense: "2" }, weight: 0.2, rarity: "common" },
  { name: "Wool Leggings", type: "apparel", qty: 1, worn: true, slot: "legs", effects: { defense: "1" }, weight: 0.3, rarity: "common" },
  { name: "Walking Boots", type: "apparel", qty: 1, worn: true, slot: "feet", effects: { defense: "1" }, weight: 0.5, rarity: "common" },
  { name: "Bread from Alheim Mill", type: "consumable", qty: 1, effects: { health: "+15", hunger: "−20" }, weight: 0.1, rarity: "common" },
  { name: "Walking Cane", type: "weapon", qty: 1, worn: true, slot: "mainhand", effects: { damage: "1–2" }, weight: 0.4, rarity: "common" },
] as const;

export const TRIVIAL_MINUTES = 10;
export const TRIVIAL_FATIGUE = 3;
export const MAX_ASKS = 3;
export const MAX_LOOKS = 1;
export const MAX_TALKS = 2;

export const DIE = 400;
export const BANDS = ["common", "common", "uncommon", "rare", "epic", "legendary"];
export const SPARK_FLOOR = 4;
export const PRESS_FLOOR = 3;

export const FATE_LABELS: Record<string, string> = {
  greater_calamity: "greater calamity",
  lesser_calamity: "lesser calamity",
  lesser_fortune: "lesser fortune",
  greater_fortune: "greater fortune",
};

export const DEFAULTS = {
  hours_per_league: 1.5,
  min_leg_minutes: 20,
  encounter_chance_per_league: 0.25,
  speed_factor: SPEED_FACTOR,
};
