import random

from . import travel
from .config import PENDING
from .state import (
    ensure_layout,
    stamp,
    load_campaign,
    load_turn,
    new_turn,
    now,
    save_campaign,
    save_turn,
)
from .steps import STEPS

SUSPENDED = ("awaiting_human", "awaiting_clock")


def pending_path(turn_id):
    return PENDING / f"{turn_id}.md"


def write_pending(turn):
    PENDING.mkdir(parents=True, exist_ok=True)
    path = pending_path(turn["turn_id"])
    if path.exists():
        return path
    path.write_text(
        f"# {turn['turn_id']} — the world is silent\n\n"
        "## Gap\n\n"
        f"{turn.get('gap', '').strip()}\n\n"
        "## Resolution\n\n"
        "<!-- run: tesbota lore -->\n",
        encoding="utf-8",
    )
    return path


def advance(campaign, turn):
    draft = turn.get("draft") or {}
    journey = draft.get("travel") or {}

    if journey.get("leagues"):
        wake_at, schedule = plan(campaign, journey["leagues"])
        return new_turn(
            campaign,
            state="awaiting_clock",
            wake_at=wake_at,
            schedule=schedule,
            destination=journey.get("destination"),
        )

    if journey.get("resume"):
        held = campaign.pop("suspended_journey", None)
        if held:
            save_campaign(campaign)
            return new_turn(
                campaign,
                state="awaiting_clock",
                wake_at=held["wake_at"],
                schedule=held["schedule"],
                destination=held.get("destination"),
            )

    minutes = int(turn.get("minutes") or 0)
    if minutes > 0:
        return new_turn(
            campaign,
            state="awaiting_clock",
            wake_at=stamp(now() + travel.real_delay(campaign["clock"], minutes)),
            schedule=[],
        )

    return new_turn(campaign, state="explorer")


def plan(campaign, leagues, rng=None):
    return travel.plan_journey(campaign["clock"], leagues, rng or random, now())


def tick_clock(turn, moment, campaign=None):
    entry = travel.due(turn, moment)
    if entry:
        entry["fired"] = True
        turn["event"] = True
        turn["state"] = "gm"
        if campaign is not None:
            campaign["suspended_journey"] = {
                "wake_at": turn["wake_at"],
                "schedule": turn["schedule"],
                "destination": turn.get("destination"),
            }
            save_campaign(campaign)
        turn["wake_at"] = None
        turn["schedule"] = []
        return True
    if travel.arrived(turn, moment):
        destination = turn.get("destination")
        turn["wake_at"] = None
        if destination:
            turn["arrival"] = destination
            turn["state"] = "gm"
        else:
            turn["state"] = "explorer"
        return True
    return False


def run(limit=1):
    ensure_layout()
    campaign = load_campaign()

    if not campaign.get("current_turn"):
        new_turn(campaign, state="explorer")

    completed = 0
    while True:
        turn = load_turn(campaign["current_turn"])
        state = turn["state"]

        if state == "awaiting_human":
            write_pending(turn)
            return "awaiting_human", turn

        if state == "awaiting_clock":
            if not tick_clock(turn, now(), campaign):
                return "awaiting_clock", turn
            save_turn(turn)
            continue

        if state == "done":
            if completed >= limit:
                return "done", turn
            turn = advance(campaign, turn)
            continue

        campaign, turn = STEPS[state](campaign, turn)
        save_turn(turn)
        save_campaign(campaign)
        if turn["state"] == "done":
            completed += 1


def resolve_gap(campaign, turn):
    turn["gap"] = None
    turn["correction"] = None
    turn["gm_retries"] = 0
    turn["state"] = "gm"
    save_turn(turn)
    path = pending_path(turn["turn_id"])
    if path.exists():
        path.unlink()
    return turn
