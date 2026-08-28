from .config import ABILITIES, MAX_FATIGUE, MAX_HEALTH, MAX_HUNGER, SKILL_ABILITY
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


def render_inventory(campaign=None):
    campaign = campaign or load_campaign()
    items = campaign.get("inventory") or []
    if not items:
        return "you are carrying nothing"
    return "you are carrying:\n" + "\n".join(f"  - {item}" for item in items)
