from datetime import timedelta

from .state import stamp


def plan_journey(clock, leagues, rng, start):
    hours_per_league = clock["hours_per_league"]
    min_leg = int(clock["min_leg_minutes"])
    chance = clock["encounter_chance_per_league"]

    total = max(min_leg, round(float(leagues) * hours_per_league * 60))
    rolls = sum(1 for _ in range(max(1, int(leagues))) if rng.random() < chance)

    candidates = sorted(rng.randint(min_leg, total) for _ in range(rolls)) if total > min_leg else []

    picked = []
    last = 0
    for offset in candidates:
        if offset - last >= min_leg and total - offset >= min_leg:
            picked.append(offset)
            last = offset

    schedule = [
        {"at": stamp(start + timedelta(minutes=offset)), "kind": "encounter", "fired": False}
        for offset in picked
    ]
    return stamp(start + timedelta(minutes=total)), schedule


def due(turn, moment):
    from .state import parse

    for entry in turn.get("schedule", []):
        if not entry["fired"] and parse(entry["at"]) <= moment:
            return entry
    return None


def arrived(turn, moment):
    from .state import parse

    return turn.get("wake_at") is not None and parse(turn["wake_at"]) <= moment
