from .config import (
    ABILITIES,
    MAX_FATIGUE,
    MAX_HEALTH,
    MAX_HUNGER,
    NOTEBOOK_MAX_CHARS,
    NOTEBOOK_MAX_NOTES,
    SKILL_ABILITY,
)
from .state import save_campaign
from .state import load_campaign

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


def render_notebook(campaign=None):
    campaign = campaign or load_campaign()
    notes = campaign.get("notebook") or []
    if not notes:
        return "your notebook is empty"
    return "your notebook:\n" + "\n".join(f"  - {n}" for n in notes)


def write_note(text):
    campaign = load_campaign()
    note = " ".join((text or "").split())[:NOTEBOOK_MAX_CHARS]
    if not note:
        return "nothing written"
    notes = campaign.setdefault("notebook", [])
    notes.append(note)
    del notes[:-NOTEBOOK_MAX_NOTES]
    save_campaign(campaign)
    return f"written: {note}"


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
            out.append(f"  {q.get('title')}" + (f"  ({q['giver']})" if q.get("giver") else ""))
            if q.get("detail"):
                out.append(f"      {q['detail']}")
    if past:
        if out:
            out.append("")
        out.append("finished:")
        for q in past:
            out.append(f"  {q.get('title')} — {q.get('status')}")
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
            "note": entry.get("note") or "",
            "worn": bool(entry.get("worn")),
        }
    return {"name": str(entry), "qty": 1, "note": "", "worn": False}


def items(campaign=None):
    campaign = campaign or load_campaign()
    return [as_item(e) for e in (campaign.get("inventory") or [])]


def render_inventory(campaign=None):
    entries = items(campaign)
    if not entries:
        return "you are carrying nothing"

    worn = [e for e in entries if e["worn"]]
    carried = [e for e in entries if not e["worn"]]

    def line(e):
        count = f" x{e['qty']}" if e["qty"] > 1 else ""
        note = f"   ({e['note']})" if e["note"] else ""
        return f"  {e['name']}{count}{note}"

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
