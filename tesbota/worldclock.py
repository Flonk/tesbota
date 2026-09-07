from .config import (
    DAY_NAMES,
    DAYS_PER_MONTH,
    DAYS_PER_WEEK,
    DAYS_PER_YEAR,
    MONTH_NAMES,
    WORLD_START,
)

MINUTES_PER_HOUR = 60
HOURS_PER_DAY = 24
MINUTES_PER_DAY = MINUTES_PER_HOUR * HOURS_PER_DAY


def fresh():
    return dict(WORLD_START)


def normalise(time):
    t = dict(fresh())
    t.update(time or {})
    minute = int(t.get("minute") or 0)
    day = int(t.get("day") or 1) + minute // MINUTES_PER_DAY
    t["minute"] = minute % MINUTES_PER_DAY
    t["year"] = int(t.get("year") or 0) + (day - 1) // DAYS_PER_YEAR
    t["day"] = (day - 1) % DAYS_PER_YEAR + 1
    return t


def month(time):
    t = normalise(time)
    return MONTH_NAMES[(t["day"] - 1) // DAYS_PER_MONTH]


def day_of_month(time):
    return (normalise(time)["day"] - 1) % DAYS_PER_MONTH + 1


def weekday(time):
    return DAY_NAMES[(normalise(time)["day"] - 1) % DAYS_PER_WEEK]


def ordinal(n):
    if 10 <= n % 100 <= 20:
        return f"{n}th"
    return f"{n}{ {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th') }"


def date(time):
    return f"{ordinal(day_of_month(time))} of {month(time)}"


def month_number(time):
    return (normalise(time)["day"] - 1) // DAYS_PER_MONTH + 1


def advance(time, minutes):
    t = normalise(time)
    t["minute"] += int(minutes or 0)
    return normalise(t)


def clock(time):
    t = normalise(time)
    return f"{t['minute'] // MINUTES_PER_HOUR:02d}:{t['minute'] % MINUTES_PER_HOUR:02d}"


def stamp(time):
    t = normalise(time)
    return f"{day_of_month(t)} {month(t)} {t['era']}E{t['year']}, {clock(t)}"


def shorten(stamp_text):
    """Rewrite a stored stamp — `1 Frostfall 4E202, 14:12` — as `1.1. 4E202`."""
    head = str(stamp_text or "").split(",")[0].strip()
    parts = head.split()
    if len(parts) != 3 or parts[1] not in MONTH_NAMES:
        return head or "—"
    return f"{parts[0]}.{MONTH_NAMES.index(parts[1]) + 1}. {parts[2]}"


def long_stamp(time):
    t = normalise(time)
    return f"{weekday(t)}, {date(t)}, {t['era']}E{t['year']}, {clock(t)}"


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
