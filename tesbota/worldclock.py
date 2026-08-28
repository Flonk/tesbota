from .config import WORLD_START

MINUTES_PER_HOUR = 60
HOURS_PER_DAY = 24
MINUTES_PER_DAY = MINUTES_PER_HOUR * HOURS_PER_DAY


def fresh():
    return dict(WORLD_START)


def normalise(time):
    t = dict(fresh())
    t.update(time or {})
    minute = int(t.get("minute") or 0)
    t["day"] = int(t.get("day") or 1) + minute // MINUTES_PER_DAY
    t["minute"] = minute % MINUTES_PER_DAY
    return t


def advance(time, minutes):
    t = normalise(time)
    t["minute"] += int(minutes or 0)
    return normalise(t)


def clock(time):
    t = normalise(time)
    return f"{t['minute'] // MINUTES_PER_HOUR:02d}:{t['minute'] % MINUTES_PER_HOUR:02d}"


def stamp(time):
    t = normalise(time)
    return f"{t['era']}E{t['year']} {clock(t)}"


def long_stamp(time):
    t = normalise(time)
    return f"{stamp(t)}, day {t['day']}"


def part_of_day(time):
    minute = normalise(time)["minute"]
    hour = minute // MINUTES_PER_HOUR
    if hour < 5:
        return "the small hours"
    if hour < 8:
        return "early morning"
    if hour < 12:
        return "morning"
    if hour < 14:
        return "midday"
    if hour < 18:
        return "afternoon"
    if hour < 21:
        return "evening"
    return "night"
