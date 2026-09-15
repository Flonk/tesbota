from . import canon, view, worldclock
from .config import (
    ABILITIES,
    EXPLORER,
    MAX_FATIGUE,
    MAX_HEALTH,
    MAX_HUNGER,
    SKILL_ABILITY,
)
from .state import explorer_name, load_campaign

HEALTH_WORDS = [(90, "unhurt"), (70, "bruised"), (45, "hurt"), (20, "badly hurt"), (0, "failing")]
FATIGUE_WORDS = [(0, "rested"), (25, "warm"), (50, "tiring"), (75, "weary"), (90, "spent")]
HUNGER_WORDS = [(0, "fed"), (25, "peckish"), (50, "hungry"), (75, "very hungry"), (90, "starving")]


def descend(value, table):
    for threshold, word in table:
        if value >= threshold:
            return word
    return table[-1][1]


def ascend(value, table):
    word = table[0][1]
    for threshold, name in table:
        if value >= threshold:
            word = name
    return word


def render_quest_log(campaign=None):
    campaign = campaign or load_campaign()
    quests = campaign.get("quests") or []
    if not quests:
        return "you have taken nothing on"

    active = [q for q in quests if q.get("status") == "active"]
    past = [q for q in quests if q.get("status") != "active"]

    out = []
    if active:
        out.append("ongoing:")
        for q in active:
            giver = f"  ({q['giver']})" if q.get("giver") else ""
            out.append(f"  {q.get('title')}{giver}  [{worldclock.shorten(q.get('at'))}]")
            if q.get("detail"):
                out.append(f"      {q['detail']}")
    if past:
        if out:
            out.append("")
        out.append("finished:")
        for q in past:
            out.append(
                f"  {q.get('title')} — {q.get('status')}  [{worldclock.shorten(q.get('closed_at'))}]"
            )
    return "\n".join(out)


def modifier(score):
    return (int(score) - 10) // 2


def skill_bonus(campaign, skill):
    skills = campaign.get("skills") or {}
    abilities = skills.get("abilities") or {}
    ability = SKILL_ABILITY.get(skill)
    if ability is None:
        return None
    total = modifier(abilities.get(ability, 10))
    if skill in set(skills.get("proficient") or []):
        total += int(skills.get("proficiency") or 0)
    return total


def render_stats(campaign=None):
    campaign = campaign or load_campaign()
    v = campaign.get("vitals") or {}
    health = v.get("health", MAX_HEALTH)
    fatigue = v.get("fatigue", 0)
    hunger = v.get("hunger", 0)

    lines = [
        explorer_name(campaign),
        "",
        f"health    {health:3} / {MAX_HEALTH}   {descend(health, HEALTH_WORDS)}",
        f"fatigue   {fatigue:3} / {MAX_FATIGUE}   {ascend(fatigue, FATIGUE_WORDS)}",
        f"hunger    {hunger:3} / {MAX_HUNGER}   {ascend(hunger, HUNGER_WORDS)}",
        "",
        "skills",
    ]
    skills = campaign.get("skills") or {}
    abilities = skills.get("abilities") or {}
    if not abilities:
        lines.append("  you have not found out what you are good at")
        return "\n".join(lines)

    lines[-1] = "abilities"
    lines.append("  " + "   ".join(
        f"{name} {abilities.get(name, 10):2} ({modifier(abilities.get(name, 10)):+d})"
        for name in ABILITIES
    ))
    lines += ["", "skills"]
    proficient = set(skills.get("proficient") or [])
    bonus = int(skills.get("proficiency") or 0)
    for name in sorted(SKILL_ABILITY):
        ability = SKILL_ABILITY[name]
        total = modifier(abilities.get(ability, 10)) + (bonus if name in proficient else 0)
        mark = "*" if name in proficient else " "
        lines.append(f"  {mark} {name:16} {ability}  {total:+d}")
    lines.append("")
    lines.append("  * trained")
    return "\n".join(lines)


def as_item(entry):
    if isinstance(entry, dict):
        return {
            "name": entry.get("name", "something"),
            "qty": int(entry.get("qty") or 1),
            "about": entry.get("about") or "",
            "worn": bool(entry.get("worn")),
        }
    return {"name": str(entry), "qty": 1, "about": "", "worn": False}


def items():
    return [as_item(e) for e in canon.holdings(EXPLORER)]


def render_inventory():
    entries = items()
    if not entries:
        return "you are carrying nothing"

    worn = [e for e in entries if e["worn"]]
    carried = [e for e in entries if not e["worn"]]

    def line(e):
        count = f" x{e['qty']}" if e["qty"] > 1 else ""
        said = [f"  {e['name']}{count}"]
        if e["about"]:
            said.append(view.wrap(canon.plain(e["about"]), width=70, indent="      "))
        return "\n".join(said)

    out = []
    if worn:
        out.append("worn:")
        out += [line(e) for e in worn]
    if carried:
        if out:
            out.append("")
        out.append("carried:")
        out += [line(e) for e in carried]
    return "\n".join(out)


def render_holdings(entity=None):
    holders = canon.holders()
    if entity:
        entity = canon.slug(entity)
        holders = [h for h in holders if h["id"] == entity]
        if not holders:
            return f"{entity} keeps nothing"
    if not holders:
        return "nobody keeps anything"

    stock = {h["id"]: canon.holdings(h["id"]) for h in holders}
    width = max(len(i["name"]) for items in stock.values() for i in items)
    out = []
    for holder in holders:
        if out:
            out.append("")
        out.append(f"{holder['name']}  ({holder['id']})")
        for item in stock[holder["id"]]:
            count = f"x{item['qty']}" if item["qty"] > 1 else ""
            out.append(f"  {item['name']:<{width}}  {count:>4}".rstrip())
    return "\n".join(out)
