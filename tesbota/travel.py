import re
from datetime import timedelta

from .state import stamp

POINTS = (
    "north", "north-north-east", "north-east", "east-north-east",
    "east", "east-south-east", "south-east", "south-south-east",
    "south", "south-south-west", "south-west", "west-south-west",
    "west", "west-north-west", "north-west", "north-north-west",
)


def compass():
    table = {}
    for n, name in enumerate(POINTS):
        for form in (name, name.replace("-", ""), name.replace("-", " "),
                     "".join(word[0] for word in name.split("-"))):
            table[form] = n * 22.5
    return table


COMPASS = compass()

UNITS = {
    "m": 1, "metre": 1, "metres": 1, "meter": 1, "meters": 1,
    "km": 1000, "kilometre": 1000, "kilometres": 1000, "kilometer": 1000, "kilometers": 1000,
    "mile": 1609, "miles": 1609,
    "league": 4800, "leagues": 4800,
}

MEASURED = re.compile(r"(\d+(?:\.\d+)?)\s*(?:(?:-|\u2013|to)\s*(\d+(?:\.\d+)?)\s*)?([a-z]+)")

PACES = (
    ("a few days", (75000, 150000)),
    ("half a day", (15000, 30000)),
    ("a day", (25000, 45000)),
    ("an hour", (3000, 6000)),
    ("a couple of minutes", (100, 300)),
    ("a few minutes", (100, 500)),
    ("a short walk", (200, 1200)),
    ("a short way", (200, 1200)),
    ("a long walk", (4000, 12000)),
)


def bearing_degrees(text):
    """Degrees clockwise from north, or nothing at all where the world never
    wrote a direction down."""
    return COMPASS.get(" ".join(str(text or "").lower().split()).strip(" .,"))


def distance_band(text):
    """A low and a high in metres, wide on purpose, or nothing where nobody has
    measured it — which is most of the roads in this world."""
    said = " ".join(str(text or "").lower().split())
    if not said:
        return None
    found = MEASURED.search(said)
    if found and found.group(3) in UNITS:
        scale = UNITS[found.group(3)]
        low = float(found.group(1)) * scale
        high = float(found.group(2)) * scale if found.group(2) else low
        return (round(low), round(high))
    for phrase, band in PACES:
        if phrase in said:
            return band
    return None


def real_delay(clock, in_world_minutes):
    factor = float(clock.get("speed_factor") or 1)
    return timedelta(seconds=(float(in_world_minutes) * 60.0) / factor)


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
        {
            "at": stamp(start + real_delay(clock, offset)),
            "kind": "encounter",
            "fired": False,
        }
        for offset in picked
    ]
    return stamp(start + real_delay(clock, total)), schedule


def due(turn, moment):
    from .state import parse

    for entry in turn.get("schedule", []):
        if not entry["fired"] and parse(entry["at"]) <= moment:
            return entry
    return None


def arrived(turn, moment):
    from .state import parse

    return turn.get("wake_at") is not None and parse(turn["wake_at"]) <= moment
