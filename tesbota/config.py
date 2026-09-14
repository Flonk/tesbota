from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CANON = ROOT / "canon"
CANON_DB = ROOT / "canon.db"
STATE = ROOT / "state"
TURNS = STATE / "turns"
PENDING = ROOT / "pending"
CAMPAIGN = STATE / "campaign.json"
DEATH = STATE / "death.json"

KINDS = ("people", "places", "books", "items")

READ_TOOLS = ["Bash"]
WRITE_TOOLS = ["Bash"]

MAX_GM_RETRIES = 3

MODEL = "claude-sonnet-5"
MODELS = {"explorer": MODEL, "gm": MODEL, "lore1": MODEL, "lore2": MODEL, "lore3": MODEL, "lore4": MODEL,
          "questmaster": "claude-opus-5"}

GODHEAD = "the godhead"
GODHEAD_ID = "the-godhead"
NARRATOR = "The Narrator"
GODHEADS = (GODHEAD, NARRATOR.lower())

TRAITS = (
    ("blunt", "common"), ("patient", "common"), ("curious", "common"),
    ("wary", "common"), ("stubborn", "common"), ("generous", "common"),
    ("thrifty", "common"), ("proud", "common"), ("anxious", "common"),
    ("loyal", "common"), ("idle", "common"), ("industrious", "common"),
    ("cheerful", "common"), ("sullen", "common"), ("talkative", "common"),
    ("quiet", "common"), ("pious", "common"), ("superstitious", "common"),
    ("practical", "common"), ("sentimental", "common"), ("hot-tempered", "common"),
    ("even-tempered", "common"), ("nosy", "common"), ("private", "common"),
    ("boastful", "common"), ("self-effacing", "common"), ("greedy", "common"),
    ("hospitable", "common"), ("suspicious", "common"), ("tender", "common"),
    ("self-critical", "common"), ("quick to laugh", "common"),
    ("slow to forgive", "common"), ("solemn", "common"), ("restless", "common"),
    ("steady", "common"), ("bawdy", "common"), ("prim", "common"),
    ("sharp-tongued", "common"), ("deferential", "common"),

    ("vain", "uncommon"), ("cowardly", "uncommon"), ("reckless", "uncommon"),
    ("vengeful", "uncommon"), ("forgiving to a fault", "uncommon"),
    ("cannot lie", "uncommon"), ("lies for no reason", "uncommon"),
    ("bitter", "uncommon"), ("fatalistic", "uncommon"), ("zealous", "uncommon"),
    ("contrarian", "uncommon"), ("credulous", "uncommon"), ("cynical", "uncommon"),
    ("possessive", "uncommon"), ("jealous", "uncommon"), ("meddling", "uncommon"),
    ("imperious", "uncommon"), ("servile", "uncommon"), ("morbid", "uncommon"),
    ("dreamy", "uncommon"), ("pedantic", "uncommon"), ("miserly", "uncommon"),
    ("profligate", "uncommon"), ("flirtatious", "uncommon"), ("prudish", "uncommon"),
    ("gullible about people", "uncommon"), ("unmoved by suffering", "uncommon"),
    ("easily shamed", "uncommon"), ("shameless", "uncommon"),
    ("incurious about anything new", "uncommon"),

    ("cruel", "rare"), ("fearless", "rare"), ("saintly", "rare"),
    ("incapable of anger", "rare"), ("incapable of stillness", "rare"),
    ("delights in ruin", "rare"), ("trusts nobody", "rare"),
    ("trusts everybody", "rare"), ("cannot feel fear", "rare"),
    ("laughs at the wrong moments", "rare"), ("weeps easily and without cause", "rare"),
    ("never sleeps a full night", "rare"), ("forgets faces", "rare"),

    ("autism", "very rare"), ("bipolar disorder", "very rare"),
    ("mania", "very rare"), ("schizophrenia", "very rare"),
    ("paranoia", "very rare"), ("melancholia", "very rare"),
    ("obsessive-compulsive disorder", "very rare"),
    ("multiple personality disorder", "very rare"),
    ("psychopathy", "very rare"), ("narcissistic personality disorder", "very rare"),
    ("selective mutism", "very rare"), ("alexithymia", "very rare"),
    ("auditory hallucinations", "very rare"), ("synesthesia", "very rare"),
    ("hyperthymesia", "very rare"), ("prosopagnosia", "very rare"),
    ("catatonia", "very rare"), ("kleptomania", "very rare"),
)


SURNAME = "Bota"

MYSTERY = "died of a mysterious cause"

FIRST_NAMES = (
    "Ansel", "Arndt", "Bastian", "Berta", "Bram", "Clemens", "Corda", "Detlev",
    "Edda", "Eike", "Elsbet", "Everd", "Frauke", "Gerd", "Gesa", "Gunda",
    "Hanne", "Harm", "Heike", "Hilke", "Ilse", "Immo", "Jelle", "Joost",
    "Karsten", "Katrin", "Klaas", "Lene", "Levke", "Lubbert", "Maren", "Meike",
    "Menno", "Mette", "Nanne", "Neele", "Onno", "Otte", "Rike", "Roelof",
    "Sanne", "Sibbe", "Sieger", "Silke", "Sonke", "Swantje", "Tammo", "Telse",
    "Thies", "Tomke", "Ubbo", "Uwe", "Vibeke", "Volkert", "Wibke", "Wiard",
    "Wilke", "Wobke", "Ynse", "Zwaantje",
)

STUB = "$BOTA"

EXPLORER = "the-explorer"

FORBIDDEN_AUTHORS = ("the explorer", "the adventurer", "explorer", "adventurer")

OPENING = {
    "narration": (
        "You are standing on a road in wet grass. Fog stands close on every side, "
        "and the road runs away from you in two directions. "
        "You should probably keep walking."
    ),
    "claims": [
        {"id": "o1", "text": "A road runs through wet grass.",
         "entity": "the-road", "kind": "places"},
        {"id": "o2", "text": "Fog stands close around the road on every side, hiding what lies beyond.",
         "entity": "the-road", "kind": "places"},
        {"id": "o3", "text": "The road runs away in two directions.",
         "entity": "the-road", "kind": "places"},
    ],
    "travel": None,
    "minutes": 0,
    "fatigue": 0,
    "health": 0,
}

DAYS_PER_WEEK = 7
WEEKS_PER_MONTH = 4
MONTHS_PER_YEAR = 8
DAYS_PER_MONTH = DAYS_PER_WEEK * WEEKS_PER_MONTH
DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR

MONTH_NAMES = (
    "Frostfall",
    "Deepfrost",
    "Frostbreak",
    "Seedwake",
    "Longlight",
    "Highsun",
    "Reaptide",
    "Emberwane",
)

DAY_NAMES = (
    "Firstday",
    "Millday",
    "Waterday",
    "Midweek",
    "Marketday",
    "Restday",
    "Lastday",
)

WORLD_START = {"era": 4, "year": 202, "day": 1, "minute": 13 * 60 + 4}

SPEED_FACTOR = 6000

MAX_HEALTH = 100
MAX_FATIGUE = 100
MAX_HUNGER = 100

HUNGER_PER_HOUR = 4

ABILITIES = ("str", "dex", "con", "int", "wis", "cha")

SKILL_ABILITY = {
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
}

STARTING_SKILLS = {
    "abilities": {"str": 10, "dex": 11, "con": 12, "int": 11, "wis": 12, "cha": 9},
    "proficiency": 2,
    "proficient": ["perception", "survival"],
}

SKILL_DIE = 20

STARTING_INVENTORY = [
    {"name": "travelling clothes", "qty": 1,
     "note": "plain and hard-wearing, none of it new", "worn": True},
    {"name": "walking boots", "qty": 1,
     "note": "worn down at the heel but sound", "worn": True},
    {"name": "notebook", "qty": 1,
     "note": "small, softbound, most of its pages still blank", "worn": False},
    {"name": "pencil stub", "qty": 1,
     "note": "blunt, sharpened with a knife more than once", "worn": False},
]

TRIVIAL_MINUTES = 10
TRIVIAL_FATIGUE = 3
MAX_ASKS = 3
MAX_LOOKS = 1
MAX_TALKS = 2

DIE = 400
BANDS = ("common", "common", "rare", "rare", "very_rare", "very_rare")
BAND_WEIGHT = {"common": 0.35, "rare": 0.12, "very_rare": 0.03}
SPARK_FLOOR = 4
PRESS_FLOOR = 3

RARITIES = ("common", "uncommon", "rare", "unique")

FATE_LABELS = {
    "greater_calamity": "greater calamity",
    "lesser_calamity": "lesser calamity",
    "lesser_fortune": "lesser fortune",
    "greater_fortune": "greater fortune",
}

DEFAULTS = {
    "hours_per_league": 1.5,
    "min_leg_minutes": 20,
    "encounter_chance_per_league": 0.25,
    "speed_factor": SPEED_FACTOR,
}
