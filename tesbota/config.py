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

TRIVIAL_MINUTES = 10
TRIVIAL_FATIGUE = 3
MAX_ASKS = 3

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
