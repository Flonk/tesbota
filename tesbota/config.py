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
]

TRIVIAL_MINUTES = 10
TRIVIAL_FATIGUE = 3
MAX_ASKS = 3
MAX_LOOKS = 2
MAX_TALKS = 4

DIE = 400
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
