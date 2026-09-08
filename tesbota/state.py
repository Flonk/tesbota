import json
import os
import random
import shutil
from datetime import datetime, timezone

from . import canon
from .config import (
    CAMPAIGN,
    DEATH,
    EXPLORER,
    DEFAULTS,
    FIRST_NAMES,
    PENDING,
    MAX_FATIGUE,
    MAX_HEALTH,
    STARTING_SKILLS,
    STATE,
    SURNAME,
    WORLD_START,
    TURNS,
)


def now():
    return datetime.now(timezone.utc)


def stamp(dt=None):
    return (dt or now()).isoformat(timespec="seconds")


def parse(value):
    return datetime.fromisoformat(value)


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def pick_name():
    """Every life gets its own name. The family name never changes; the world only
    ever meets one Bota at a time."""
    taken = canon.given_names()
    pool = [n for n in FIRST_NAMES if n.lower() not in taken] or list(FIRST_NAMES)
    return f"{random.choice(pool)} {SURNAME}"


def explorer_name(campaign=None):
    return (campaign or load_campaign()).get("explorer") or "the explorer"


def new_campaign():
    return {
        "explorer": None,
        "sessions": {"explorer": None, "gm": None, "lore3_sitting": None},
        "current_turn": None,
        "turn_counter": 0,
        "clock": dict(DEFAULTS),
        "time": dict(WORLD_START),
        "vitals": {"health": MAX_HEALTH, "fatigue": 0, "hunger": 0},
        "notebook": [],
        "quests": [],
        "skills": json.loads(json.dumps(STARTING_SKILLS)),
        "last_narration": None,
        "note": None,
        "location": None,
        "location_path": [],
        "last_seen": None,
        "created": stamp(),
    }


def stock(inventory):
    """Move what the explorer was carrying in the campaign file into canon, where
    everything anybody holds now lives."""
    for entry in inventory:
        if isinstance(entry, dict):
            canon.give(EXPLORER, entry.get("name"), entry.get("qty") or 1,
                       note=entry.get("note") or "", worn=bool(entry.get("worn")))
        else:
            canon.give(EXPLORER, entry)


def load_campaign():
    if not CAMPAIGN.exists():
        campaign = new_campaign()
        campaign["explorer"] = pick_name()
        write_json(CAMPAIGN, campaign)
        return campaign

    campaign = read_json(CAMPAIGN)
    blank = new_campaign()
    changed = False
    if not campaign.get("explorer"):
        campaign["explorer"] = pick_name()
        changed = True
    for key in ("note", "location", "location_path", "notebook", "quests", "time"):
        if key not in campaign:
            campaign[key] = blank[key]
            changed = True
    for key in ("skills", "clock"):
        if not campaign.get(key):
            campaign[key] = blank[key]
            changed = True
    if "inventory" in campaign:
        stock(campaign.pop("inventory") or [])
        changed = True

    vitals = campaign.setdefault("vitals", blank["vitals"])
    for key, value in blank["vitals"].items():
        if key not in vitals:
            vitals[key] = value
            changed = True
    if changed:
        write_json(CAMPAIGN, campaign)
    return campaign


def save_campaign(campaign):
    write_json(CAMPAIGN, campaign)


def record_death(cause):
    """A death is asked for here and carried out by the driver, because whoever
    calls for one may be in the middle of a turn that still has to be written."""
    write_json(DEATH, {"cause": cause, "at": stamp()})
    return cause


def pending_death():
    return read_json(DEATH) if DEATH.exists() else None


def clear_death():
    DEATH.unlink(missing_ok=True)


def retire(campaign):
    """Put a finished life away whole — its turns, its campaign file, whatever the
    world was still waiting on it for. What it wrote stays in the library."""
    home = STATE / "lives" / (canon.slug(explorer_name(campaign)) or "the-nameless")
    home.mkdir(parents=True, exist_ok=True)
    (home / "turns").mkdir(exist_ok=True)
    for path in sorted(TURNS.glob("t*.json")):
        shutil.move(str(path), home / "turns" / path.name)
    if PENDING.exists():
        for path in sorted(PENDING.glob("*.md")):
            shutil.move(str(path), home / path.name)
    if CAMPAIGN.exists():
        shutil.move(str(CAMPAIGN), home / "campaign.json")
    return home


def turn_path(turn_id):
    return TURNS / f"{turn_id}.json"


def all_turns():
    return [read_json(p) for p in sorted(TURNS.glob("t*.json"))]


def new_turn(campaign, state="explorer", **fields):
    campaign["turn_counter"] += 1
    turn_id = f"t{campaign['turn_counter']:04d}"
    turn = {
        "turn_id": turn_id,
        "state": state,
        "created": stamp(),
        "action": None,
        "draft": None,
        "verdicts": [],
        "correction": None,
        "gm_retries": 0,
        "gap": None,
        "wake_at": None,
        "schedule": [],
        "minutes": 0,
    }
    turn.update(fields)
    campaign["current_turn"] = turn_id
    write_json(turn_path(turn_id), turn)
    save_campaign(campaign)
    return turn


def load_turn(turn_id):
    return read_json(turn_path(turn_id))


def save_turn(turn):
    write_json(turn_path(turn["turn_id"]), turn)


def ensure_layout():
    STATE.mkdir(parents=True, exist_ok=True)
    TURNS.mkdir(parents=True, exist_ok=True)
