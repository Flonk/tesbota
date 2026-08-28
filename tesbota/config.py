from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CANON = ROOT / "canon"
STATE = ROOT / "state"
TURNS = STATE / "turns"
PENDING = ROOT / "pending"
CAMPAIGN = STATE / "campaign.json"

KINDS = ("people", "places", "books", "items")

READ_TOOLS = ["Read", "Glob", "Grep"]
WRITE_TOOLS = ["Read", "Glob", "Grep", "Write", "Edit"]

MAX_GM_RETRIES = 3

MODEL = "claude-sonnet-5"
MODELS = {"explorer": MODEL, "gm": MODEL, "lore1": MODEL, "lore3": MODEL}

GODHEAD = "the godhead"

STUB = "$BOTA"

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
    "quotes": [],
    "travel": None,
    "minutes": 0,
    "fatigue": 0,
    "health": 0,
    "risk": 0,
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

NOTEBOOK_MAX_CHARS = 120
NOTEBOOK_MAX_NOTES = 24

DIE = 400
SPARK_DIE = 6
SPARK_FACE = 6
SPARK_FLOOR = 4

RARITIES = ("common", "uncommon", "rare", "unique")
BASE_RISK = 1
MAX_RISK = 100

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
