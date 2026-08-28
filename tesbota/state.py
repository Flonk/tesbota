import json
import os
from datetime import datetime, timezone

from .config import (
    CAMPAIGN,
    DEFAULTS,
    MAX_FATIGUE,
    MAX_HEALTH,
    STARTING_INVENTORY,
    STARTING_SKILLS,
    STATE,
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


def new_campaign():
    return {
        "sessions": {"explorer": None, "gm": None, "lore3_sitting": None},
        "current_turn": None,
        "turn_counter": 0,
        "clock": dict(DEFAULTS),
        "vitals": {"health": MAX_HEALTH, "fatigue": 0, "hunger": 0},
        "inventory": list(STARTING_INVENTORY),
        "skills": json.loads(json.dumps(STARTING_SKILLS)),
        "last_narration": None,
        "last_seen": None,
        "created": stamp(),
    }


def load_campaign():
    if not CAMPAIGN.exists():
        campaign = new_campaign()
        write_json(CAMPAIGN, campaign)
        return campaign

    campaign = read_json(CAMPAIGN)
    blank = new_campaign()
    changed = False
    for key in ("inventory", "skills", "clock"):
        if not campaign.get(key):
            campaign[key] = blank[key]
            changed = True
    inventory = campaign.get("inventory") or []
    if inventory and any(isinstance(e, str) for e in inventory):
        campaign["inventory"] = [
            e if isinstance(e, dict) else {"name": e, "qty": 1, "note": "", "worn": False}
            for e in inventory
        ]
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
