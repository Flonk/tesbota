import json
import re

from . import canon, chronicle, prompts, sheet, worldclock
import random

from .gate import sqlite_gate
from .config import (
    GODHEAD_ID,
    BANDS,
    BLOW_FATIGUE,
    DEFENSE_HALVES,
    BLOW_MINUTES,
    EXPLORER,
    FLEE_FLOOR,
    MAX_BLOWS,
    UNARMED,
    WEIGHT,
    SPARK_FLOOR,
    PRESS_FLOOR,
    DIE,
    MAX_ASKS,
    MAX_LOOKS,
    MAX_TALKS,
    MAX_FATIGUE,
    MAX_GM_RETRIES,
    HUNGER_PER_HOUR,
    MAX_HEALTH,
    MAX_HUNGER,
    MODELS,
    SKILL_DIE,
    OPENING,
    READ_TOOLS,
    TRIVIAL_FATIGUE,
    TRIVIAL_MINUTES,
)
from .sdk import ask, extract_json
from .state import explorer_name, pending_death, record_death


def phase(turn, who, kind, text, **extra):
    entries = turn.setdefault("phases", [])
    entry = {
        "n": len(entries) + 1,
        "who": who,
        "kind": kind,
        "text": text,
        "status": "said" if who == "explorer" else "pending",
        "claims": [],
    }
    entry.update(extra)
    entries.append(entry)
    return entry


def gm_phase(turn, kind, text, **extra):
    """Append what the game master said. A pending phase is rewritten in place —
    that only happens when lore master 1 has sent it back."""
    entries = turn.setdefault("phases", [])
    if entries and entries[-1]["who"] == "gm" and entries[-1]["status"] == "pending":
        entries[-1]["kind"] = kind
        entries[-1]["text"] = text
        entries[-1]["redrafts"] = entries[-1].get("redrafts", 0) + 1
        entries[-1].update(extra)
        return entries[-1]
    return phase(turn, "gm", kind, text, **extra)


def open_phase(turn):
    entries = turn.get("phases") or []
    if entries and entries[-1]["who"] == "gm" and entries[-1]["status"] == "pending":
        return entries[-1]
    return None


EXPLORER_COMMANDS = ("tesbota stats", "tesbota inventory", "tesbota quests")


def normalise_command(text):
    parts = (text or "").strip().split()
    if parts[:2] == ["uv", "run"]:
        parts = parts[2:]
    return " ".join(parts)


async def explorer_permission(tool_name, tool_input, context):
    from claude_agent_sdk import PermissionResultAllow, PermissionResultDeny

    if tool_name != "Bash":
        return PermissionResultDeny(
            message="You have no such power. You may run tesbota stats, tesbota inventory or tesbota quests."
        )
    raw = (tool_input or {}).get("command") or ""
    if any(ch in raw for ch in ";|&$`><\n"):
        return PermissionResultDeny(message="Nothing happens.")

    command = normalise_command(raw)
    if command in EXPLORER_COMMANDS:
        return PermissionResultAllow()
    return PermissionResultDeny(
        message=(
            "Nothing happens. The only things you can do are `tesbota stats`, "
            "`tesbota inventory` and `tesbota quests`."
        )
    )


ACTION_PREFIX = ("ACTION:", "DO:", "ACT:")


def unprefixed(text):
    """The explorer is told the action needs no prefix and writes one anyway."""
    bare = (text or "").strip()
    for mark in ACTION_PREFIX:
        if bare.upper().startswith(mark):
            return bare[len(mark):].strip()
    return bare


def first_utterance(text):
    lines = (text or "").strip().splitlines()
    kept = []
    for line in lines:
        bare = line.strip()
        if not bare:
            if kept:
                break
            continue
        if normalise_command(bare).split()[:1] == ["tesbota"]:
            continue
        if bare.upper().startswith(("LOOK:", "SAY:")):
            if kept:
                break
            return bare
        kept.append(bare)
    return unprefixed(" ".join(kept).strip())


DONE_WORDS = (
    "done", "nothing further", "nothing else", "nothing more", "that is all",
    "that's all", "thats all", "ready", "no more", "move on", "finished",
    "i'm good", "im good", "carry on", "let's go", "lets go",
)

QUOTES = "\"'\u201c\u2018\u201e\u00ab"


def classify(text, turn):
    """Work out whether an utterance is a look, a say, or the end of the turn.
    The prefixes are honoured when given; otherwise a question is a look and
    speech is a say, so the explorer need not remember the syntax."""
    stripped = unprefixed(text)
    upper = stripped.upper()

    if upper.startswith("LOOK:"):
        return "look", stripped[5:].strip()
    if upper.startswith("SAY:"):
        return "say", stripped[4:].strip()

    bare = stripped.lower().strip(".!\u2026 ")
    if any(bare == w or bare.startswith(w + " ") or bare.startswith("i am " + w)
           for w in DONE_WORDS):
        return "done", stripped
    if len(bare) <= 48 and any(w in bare for w in DONE_WORDS):
        return "done", stripped

    looks_left = len(turn.get("looks") or []) < MAX_LOOKS
    talks_left = len(turn.get("talks") or []) < MAX_TALKS

    if stripped[:1] in QUOTES and talks_left:
        return "say", stripped.strip(QUOTES + "\u201d\u2019\u00bb")
    if stripped.endswith("?"):
        if looks_left:
            return "look", stripped
        if talks_left:
            return "say", stripped
    return "done", stripped


def step_explorer(campaign, turn):
    text, session = ask(
        prompts.explorer_turn(
            campaign.get("last_narration"),
            nudge=turn.get("nudge"),
            check=turn.get("check"),
        ),
        system=prompts.EXPLORER_SYSTEM,
        tools=["Bash"],
        session=campaign["sessions"]["explorer"],
        model=MODELS["explorer"],
        permission=explorer_permission,
    )
    campaign["sessions"]["explorer"] = session

    stripped = first_utterance(text)
    upper = stripped.upper()

    if not stripped:
        turn["blank"] = turn.get("blank", 0) + 1
        if turn["blank"] >= MAX_ASKS:
            turn["gap"] = (
                "The adventurer has said nothing that can be acted on:\n\n"
                + (text or "").strip()[:600]
            )
            turn["state"] = "awaiting_human"
        else:
            turn["state"] = "explorer"
        return campaign, turn

    if not turn.get("action") and not upper.startswith(("LOOK:", "SAY:")):
        turn["action"] = stripped
        phase(turn, "explorer", "action", stripped)
        turn["state"] = "propose"
        return campaign, turn

    if not turn.get("action") and upper.startswith(("LOOK:", "SAY:")):
        turn["nudge"] = turn.get("nudge", 0) + 1
        if turn["nudge"] < MAX_ASKS:
            turn["state"] = "explorer"
            return campaign, turn
        turn["action"] = stripped.split(":", 1)[1].strip()
        phase(turn, "explorer", "action", turn["action"])
        turn["state"] = "propose"
        return campaign, turn

    kind, said = classify(stripped, turn)
    caps = {"look": MAX_LOOKS, "say": MAX_TALKS}
    buckets = {"look": "looks", "say": "talks"}

    if kind in caps and len(turn.get(buckets[kind]) or []) < caps[kind]:
        turn["question"] = said
        turn["mode"] = kind
        turn["looking"] = True
        phase(turn, "explorer", kind, said)
        turn["state"] = "answer"
        return campaign, turn

    stripped = said

    turn["ready"] = stripped
    if turn.get("resolved"):
        turn["delivered"] = True
        turn["state"] = "narrate"
    else:
        turn["state"] = "propose"
    return campaign, turn


def step_narrate(campaign, turn):
    """The turn is over and it survived adjudication. It is set down as it stands."""
    if chronicle.played(turn):
        written = chronicle.write(turn)
        if written:
            turn["chronicle"] = (turn.get("chronicle") or []) + written
    turn["state"] = "done"
    return campaign, turn


def ledger(campaign):
    """What the game master's session has already been handed. A session that has
    gone means it has been handed nothing, so the slate goes with it."""
    if not campaign["sessions"].get("gm"):
        campaign["sent"] = {}
    return campaign.setdefault("sent", {})


def step_answer(campaign, turn):
    text, session = ask(
        prompts.gm_answer(
            turn.get("question"),
            previous=campaign.get("last_narration"),
            mode=turn.get("mode") or "look",
            inventory=canon.holdings(EXPLORER),
            load=sheet.load(campaign),
            others=canon.holdings_at(campaign.get("location")),
            correction=turn.get("correction"),
            sent=ledger(campaign),
        ),
        system=prompts.GM_SYSTEM,
        tools=READ_TOOLS,
        permission=sqlite_gate(),
        session=campaign["sessions"]["gm"],
        model=MODELS["gm"],
    )
    campaign["sessions"]["gm"] = session
    draft = extract_json(text)
    draft.setdefault("claims", [])
    draft["travel"] = None
    draft["minutes"] = 0
    draft["fatigue"] = 0
    draft["health"] = 0
    draft["check"] = None
    turn["draft"] = draft
    gm_phase(turn, "answer", draft.get("narration"))
    turn["correction"] = None
    turn["state"] = "lore1"
    return campaign, turn


def step_propose(campaign, turn):
    if campaign.get("note") and not turn.get("note"):
        turn["note"] = campaign["note"]
        campaign["note"] = None

    text, session = ask(
        prompts.gm_propose(
            turn.get("action"),
            previous=campaign.get("last_narration"),
            vitals=campaign.get("vitals"),
            answers=turn.get("answers") or [],
            note=turn.get("note"),
            inventory=canon.holdings(EXPLORER),
            load=sheet.load(campaign),
            others=canon.holdings_at(campaign.get("location")),
            now=worldclock.long_stamp(campaign.get("time")),
        ),
        system=prompts.GM_PROPOSE_SYSTEM,
        tools=READ_TOOLS,
        permission=sqlite_gate(),
        session=None,
        model=MODELS["gm"],
    )
    out = extract_json(text)

    question = (out.get("ask") or "").strip() if isinstance(out.get("ask"), str) else None
    answers = turn.setdefault("answers", [])
    if question and len(answers) < MAX_ASKS:
        reply, _ = ask(
            prompts.lore1_query(question),
            system=prompts.LORE1_QUERY_SYSTEM,
            tools=READ_TOOLS,
            permission=sqlite_gate(),
            session=None,
            model=MODELS["lore1"],
        )
        answers.append([question, reply.strip()])
        turn["state"] = "propose"
        return campaign, turn

    proposal = out.get("proposal")
    priced = isinstance(proposal, dict) and "minutes" in proposal

    if not priced:
        turn["propose_retries"] = turn.get("propose_retries", 0) + 1
        if turn["propose_retries"] < 2:
            turn["state"] = "propose"
            return campaign, turn
        proposal = {
            "summary": turn.get("action") or "",
            "target": None,
            "minutes": TRIVIAL_MINUTES,
            "fatigue": TRIVIAL_FATIGUE,
            "unpriced": True,
        }

    proposal.setdefault("summary", turn.get("action") or "")
    proposal["minutes"] = int(proposal.get("minutes") or 0)
    proposal["fatigue"] = int(proposal.get("fatigue") or 0)
    turn["proposal"] = proposal

    outcomes = weigh_outcomes(out.get("outcomes"))
    if outcomes:
        strange = campaign.get("quiet", 0) >= SPARK_FLOOR
        turn["outcomes"] = outcomes
        turn["fortune"] = random.random()
        turn["chosen"] = spin(outcomes, turn["fortune"], only=("epic", "legendary") if strange else None)
        turn["forced_strange"] = strange

    turn["confirmed"] = True
    turn["state"] = "gm"
    return campaign, turn


def due_press(turn, campaign=None):
    if "pressed" not in turn:
        turn["pressed"] = (campaign or {}).get("calm", 0) >= PRESS_FLOOR
    return turn["pressed"]


def weigh_outcomes(raw):
    """Six ways it could go, one to a band up the ladder, weights made to add up.
    A malformed table is thrown away; a missing weight falls back to its band."""
    entries = [e for e in (raw or []) if isinstance(e, dict) and (e.get("text") or "").strip()]
    kept, used = [], []
    for band in BANDS:
        match = next(
            (e for e in entries if e.get("band") == band and id(e) not in used), None
        )
        if match is None:
            return []
        used.append(id(match))
        kept.append(match)
    out = []
    for entry in kept:
        try:
            weight = float(entry.get("p"))
        except (TypeError, ValueError):
            weight = 0
        if not weight > 0:
            weight = WEIGHT[entry["band"]]
        out.append({"band": entry["band"], "text": entry["text"].strip(), "p": weight})
    total = sum(e["p"] for e in out)
    for entry in out:
        entry["p"] = entry["p"] / total
    return out


def spin(outcomes, fortune, only=None):
    wanted = (only,) if isinstance(only, str) else only
    pool = [e for e in outcomes if e["band"] in wanted] if wanted else list(outcomes)
    if not pool:
        pool = list(outcomes)
    total = sum(e["p"] for e in pool)
    edge, running = fortune * total, 0.0
    for entry in pool:
        running += entry["p"]
        if edge < running:
            return entry
    return pool[-1]


def step_gm(campaign, turn):
    if not campaign["sessions"]["gm"] and not campaign.get("last_narration"):
        turn["draft"] = json.loads(json.dumps(OPENING))
        turn["opening"] = True
        turn["state"] = "lore1"
        return campaign, turn

    text, session = ask(
        prompts.gm_turn(
            turn.get("action"),
            previous=campaign.get("last_narration"),
            vitals=campaign.get("vitals"),
            correction=turn.get("correction"),
            event=turn.get("event"),
            left=turn.get("leagues_left"),
            arrival=turn.get("arrival"),
            agreed=turn.get("proposal") if turn.get("confirmed") else None,
            note=turn.get("note"),
            chosen=turn.get("chosen"),
            press=due_press(turn, campaign),
            inventory=canon.holdings(EXPLORER),
            load=sheet.load(campaign),
            others=canon.holdings_at(campaign.get("location")),
            quests=campaign.get("quests") or [],
            now=worldclock.long_stamp(campaign.get("time")),
            sent=ledger(campaign),
            standing=campaign.get("fight"),
        ),
        system=prompts.GM_SYSTEM,
        tools=READ_TOOLS,
        permission=sqlite_gate(also=("tesbota kill", "tesbota traits")),
        session=campaign["sessions"]["gm"],
        model=MODELS["gm"],
    )
    campaign["sessions"]["gm"] = session
    draft = extract_json(text)
    draft.setdefault("claims", [])
    draft.setdefault("travel", None)
    draft.setdefault("minutes", 0)
    draft.setdefault("fatigue", 0)
    draft.setdefault("health", 0)
    draft.setdefault("hunger", None)
    draft.setdefault("check", None)
    draft.setdefault("location", None)
    draft.setdefault("transactions", [])
    draft.setdefault("quest_open", [])
    draft.setdefault("quest_update", [])
    draft.setdefault("quest_close", [])

    agreed = turn.get("proposal") if turn.get("confirmed") else None
    if agreed:
        draft["minutes"] = agreed["minutes"]
        draft["fatigue"] = agreed["fatigue"]
    turn["draft"] = draft
    world = (turn.get("arrival") or turn.get("event")) and not turn.get("action")
    gm_phase(turn, "world" if world else "outcome", draft.get("narration"))
    turn["correction"] = None
    if (draft.get("fight") or campaign.get("fight")) and not (turn.get("fight") or {}).get("blows"):
        open_fight(campaign, turn, draft)
        turn["state"] = "muster"
        return campaign, turn
    turn["state"] = "lore1"
    return campaign, turn


def bandtop(said):
    """The worst a band can do, for a fumble."""
    found = BAND.search(str(said or "")) or BAND.search(UNARMED)
    return int(found.group(3) or max(int(found.group(1)), int(found.group(2))))


def fighter(said, kind, fallback_dc=11):
    """One body in a fight, on either side. What it is comes off its record, so a Rat
    is the same Rat every time; what the game master wrote stands over the record for
    this fight only and is never written back."""
    ident = canon.slug(said.get("who") or said.get("name") or kind)
    kept = canon.body(ident) or {}
    written = canon.called(ident)

    def take(field, fallback=None):
        said_it = said.get(field)
        if said_it not in (None, ""):
            return said_it
        held = kept.get(field)
        return fallback if held in (None, "") else held

    health = int(take("health") or 10)
    return {
        "id": ident,
        "as_written": dict(said),
        "name": str(said.get("name") or written or said.get("who") or kind),
        "kind": kind,
        "health": health,
        "most": int(said.get("most") or health),
        "opened": health,
        "damage": str(take("damage") or UNARMED),
        "dc": int(take("dc") or fallback_dc),
        "bonus": int(take("bonus") or 0),
        "defense": int(take("defense") or 0) + worn_defense(ident),
        "skill": str(take("skill") or "").lower() or None,
        "ability": said.get("ability") or None,
        "asleep": 0,
        "cool": 0,
        "dead": False,
    }


def unbound(fight):
    """Bodies the game master named that the world has no row for. Everything else in
    a fight is a thing already written down, and is met as what it is."""
    return [x for x in fight["them"] + fight["us"][1:] if not canon.called(x["id"])]


def rebind(fight, declared, bound):
    """A body the lore master matched to something already recorded. It comes back as
    that thing, with that thing's stats, keeping whatever the game master wrote over
    them and whatever it called it in the scene."""
    for side in ("them", "us"):
        for at, who in enumerate(fight[side]):
            if who["id"] != declared:
                continue
            said = dict(who.get("as_written") or {})
            said["who"] = bound
            said.setdefault("name", who["name"])
            fight[side][at] = fighter(said, who["kind"])
            return fight[side][at]
    return None


def open_fight(campaign, turn, draft):
    """A fight the game master has just declared, or the one it walked away from
    and has now walked back into. Everybody on both sides, in the order they act."""
    said = draft.get("fight") or {}
    held = campaign.get("fight") or {}
    if not said and held:
        said = held
    them = said.get("them")
    if not them:
        them = [said] if said.get("name") or said.get("health") else []
    weapon, hurt = swung_with(campaign)
    vitals = campaign.get("vitals") or {}
    skill = str(said.get("skill") or "athletics").lower()

    me = {
        "id": EXPLORER,
        "name": explorer_name(campaign),
        "kind": "explorer",
        "health": vitals.get("health", MAX_HEALTH),
        "most": MAX_HEALTH,
        "opened": vitals.get("health", MAX_HEALTH),
        "damage": hurt,
        "weapon": weapon,
        "dc": int(said.get("their_dc") or 11),
        "bonus": sheet.skill_bonus(campaign, skill) or 0,
        "defense": worn_defense(),
        "skill": skill,
        "ability": None,
        "asleep": 0,
        "dead": False,
    }
    me.update(standing_in(campaign, skill))

    fight = {
        "skill": skill,
        "flee_dc": int(said.get("flee_dc") or 10),
        "us": [me] + [fighter(x, "ally") for x in said.get("us") or []],
        "them": [fighter(x, "foe") for x in them],
        "turn": 0,
        "round": 1,
        "ended": None,
        "blows": [],
        "said": (draft.get("narration") or "").strip(),
    }
    for foe in fight["them"]:
        borne(foe, campaign)
    fight["name"] = fight["them"][0]["name"] if fight["them"] else "it"
    turn["fight"] = fight
    # The page draws whatever is on the turn, so the fight goes on the turn the
    # moment it is declared. Waiting for the last blow means nobody sees any of it.
    show_fight(turn, fight)
    return fight


def show_fight(turn, fight):
    """Keep the drawn phase pointing at the fight as it stands. Saving and loading
    the turn parts the two copies, so this re-marries them every blow."""
    for entry in turn.get("phases") or []:
        if entry.get("kind") == "fight":
            entry["fight"] = fight
            return entry
    return gm_phase(turn, "fight", fight.get("said") or "", fight=fight)


def standing_on(campaign):
    """Every place they are inside, innermost first."""
    chain = [campaign.get("location")] + [
        (x.get("id") if isinstance(x, dict) else x)
        for x in reversed(campaign.get("location_path") or [])
    ]
    seen, out = set(), []
    for x in chain:
        if x and x not in seen:
            seen.add(x)
            out.append(x)
    return out


def counts_here(power, campaign):
    """Whether what a body can do counts on the ground it is standing on."""
    ground = set(standing_on(campaign))
    if power.get("within") and canon.slug(power["within"]) not in ground:
        return False
    if power.get("in_kind"):
        sat = canon.find_place(campaign.get("location"))
        if not sat or sat["type"] != power["in_kind"]:
            return False
    if power.get("in_aspect") and not any(
        canon.marked_with(x, power["in_aspect"]) for x in ground
    ):
        return False
    return True


STAND_IN = re.compile(r"\$([A-Z_]+)_NAME")


def named_for(text, campaign):
    """`$GUARDED_NAME Guard` is an Alheim Guard in Alheim and a Greater Plains Guard
    on the road between. The token names an aspect; whoever answers is the nearest
    place around them carrying it."""
    def swap(found):
        want = found.group(1).lower().replace("_", "-")
        for place in standing_on(campaign):
            if canon.marked_with(place, want):
                known = canon.find_entity(place)
                return known["name"] if known else place.replace("-", " ")
        return found.group(0)
    return STAND_IN.sub(swap, str(text or ""))


def borne(who, campaign):
    """What a body is marked with, and what its markings hand it here. A citizen is
    only worth anything where the mark says it is."""
    marks = canon.aspects_of(who["id"])
    who["aspects"] = [
        {"name": m["name"], "value": m["value"], "of": m["of"]} for m in marks
    ]
    if who.get("ability"):
        return who
    for mark in marks:
        for power in canon.abilities_of(mark["aspect"]):
            if not counts_here(power, campaign):
                continue
            power = dict(power, **{"from": mark["name"]})
            if power.get("spawn"):
                called = named_for(power["spawn"].get("name"), campaign)
                # Nobody to answer means nobody comes. A citizen out on the road can
                # shout as long as they like.
                if STAND_IN.search(called):
                    continue
                power["spawn"] = dict(power["spawn"], name=called)
            who["ability"] = power
            return who
    return who


def worn_defense(holder=EXPLORER):
    """What a body has on adds up, whoever it is. Nothing carried but not worn counts."""
    total = 0
    for held in canon.holdings(holder):
        if not held.get("worn"):
            continue
        for e in held.get("effects") or []:
            if e["stat"] == "defense":
                try:
                    total += int(re.sub(r"[^0-9-]", "", e["amount"]) or 0)
                except ValueError:
                    pass
    return total


def standing_in(campaign, skill):
    """What the explorer wore and could reach for when the fight opened. A fight is
    read long after it happened, and should read as it stood."""
    vitals = campaign.get("vitals") or {}
    kept = canon.holdings(EXPLORER)
    return {
        "fatigue": vitals.get("fatigue", 0),
        "hunger": vitals.get("hunger", 0),
        "worn": [
            {"id": h["item"], "name": h["name"], "slot": h.get("slot"),
             "type": h.get("type"), "rarity": h.get("rarity"),
             "does": canon.does(h.get("effects"))}
            for h in kept if h.get("worn")
        ],
    }


def order(fight):
    """Everybody in the fight, in the order they act — our side then theirs, and
    anything that arrives partway through falls in at the back."""
    return fight["us"] + fight["them"]


def standing(fight):
    return [x for x in order(fight) if not x["dead"]]


def whose_turn(fight):
    """Whose turn it is, skipping the fallen. The pointer walks a fixed list rather
    than a shrinking one, so a death never hands anybody a second swing."""
    line = order(fight)
    if not line or all(x["dead"] for x in line):
        return None
    for step in range(len(line) + 1):
        at = fight["turn"] + step
        if at >= len(line):
            fight["turn"], fight["round"] = 0, fight["round"] + 1
            return whose_turn(fight)
        if not line[at]["dead"]:
            fight["turn"] = at
            return line[at]
    return None


def marks(fight, who):
    """Who this one swings at — the other side, weakest first, so a fight closes
    rather than spreading thin."""
    side = fight["them"] if who["kind"] != "foe" else fight["us"]
    up = [x for x in side if not x["dead"]]
    return min(up, key=lambda x: x["health"]) if up else None


def usable(campaign):
    return [h for h in canon.holdings(EXPLORER)
            if h.get("type") == "consumable" and int(h.get("qty") or 0) > 0]


def ready(who):
    """Whether what it can do is there to be done. A thing used once is done with;
    anything else waits out its cooldown."""
    power = who.get("ability")
    if not power:
        return False
    if power.get("spawn"):
        return not power.get("used")
    return int(who.get("cool") or 0) <= 0


def strike(fight, who, mark, skill, dc, rng, campaign=None, turn=None, edge=False, hurts=None):
    """One swing. The driver rolls; nobody argues with it. `edge` throws two dice and
    keeps the better, which is the one thing a body can have going for it."""
    if who["kind"] == "explorer" and campaign is not None:
        turn["draft"]["check"] = {"skill": skill, "dc": dc}
        check = roll_check(campaign, turn, rng)
        if check is None:
            check = {"skill": skill, "dc": dc, "roll": rng.randint(1, SKILL_DIE),
                     "rolls": [], "against": [], "bonus": who["bonus"]}
            check["rolls"] = [check["roll"]]
            check["total"] = check["roll"] + check["bonus"]
            check["passed"] = check["total"] >= dc
    else:
        rolls = [rng.randint(1, SKILL_DIE) for _ in range(2 if edge else 1)]
        roll = max(rolls) if edge else rolls[0]
        check = {"skill": skill or "a swing", "dc": dc, "roll": roll, "rolls": rolls,
                 "for": ["the better of two"] if edge else [],
                 "against": [], "bonus": who["bonus"], "total": roll + who["bonus"],
                 "passed": roll + who["bonus"] >= dc}
    band_of = hurts or who["damage"]
    hurt = 0
    if check["passed"]:
        hurt = band(band_of, rng)
        if check["roll"] == SKILL_DIE:
            hurt += band(band_of, rng)
    return check, hurt


def spawn(fight, who, rng, said=None):
    """An ability that puts bodies on the field — one, or a street's worth."""
    said = said or who["ability"]["spawn"]
    come = []
    for _ in range(max(1, int(said.get("count") or 1))):
        born = fighter(said, "foe")
        same = sum(1 for x in fight["them"] if x["name"].split(" #")[0] == born["name"])
        if same:
            born["id"] = f"{born['id']}-{same + 1}"
            born["name"] = f"{born['name']} #{same + 1}"
        fight["them"].append(born)
        come.append(born)
    return come


def step_swing(campaign, turn):
    """Ask them what they do with this turn of theirs. One line out, one word back."""
    fight = turn["fight"]
    me = fight["us"][0]
    first = not fight["blows"]
    message = (
        prompts.fight_open(fight, me, usable(campaign))
        if first
        else prompts.fight_blow(fight, me, said_blow(fight["blows"][-1]))
    )
    text, session = ask(
        message,
        system=prompts.EXPLORER_SYSTEM,
        tools=["Bash"],
        session=campaign["sessions"]["explorer"],
        model=MODELS["explorer"],
        permission=explorer_permission,
    )
    campaign["sessions"]["explorer"] = session
    turn["swing"] = chosen_blow(first_utterance(text) or text, campaign, fight)
    turn["state"] = "fight"
    return campaign, turn


def step_fight(campaign, turn, rng=random):
    """Whoever's turn it is takes it. The explorer is asked; everybody else is rolled."""
    fight = turn["fight"]
    who = whose_turn(fight)
    if who is None:
        fight["ended"] = fight["ended"] or "beaten"
        turn["state"] = "blows"
        return campaign, turn

    if who["kind"] == "explorer" and "swing" not in turn:
        turn["state"] = "swing"
        return campaign, turn

    blow = {
        "n": len(fight["blows"]) + 1,
        "round": fight["round"],
        "who": who["id"],
        "name": who["name"],
        "side": "us" if who["kind"] != "foe" else "them",
        "chose": "ATTACK",
        "hit": False,
        "dealt": 0,
        "taken": 0,
        "check": None,
        "text": "",
    }

    if who["asleep"] > 0:
        who["asleep"] -= 1
        blow.update(chose="ASLEEP", spent=True)
    elif who["kind"] == "explorer":
        take_turn(campaign, turn, fight, who, blow, rng)
    elif ready(who) and who["ability"].get("spawn"):
        power = who["ability"]
        wait = int(power.get("delay") or 0)
        blow["chose"] = str(power.get("name") or "spawns")
        if wait:
            fight.setdefault("owed", []).append(
                {"at": fight["round"] + wait, "spawn": power["spawn"], "by": who["name"]}
            )
            blow["calling"] = f"{power['spawn'].get('name')} x{power['spawn'].get('count') or 1}"
        else:
            born = spawn(fight, who, rng)
            blow["spawned"] = ", ".join(x["name"] for x in born)
        who["asleep"] = int(power.get("sleep") or 0)
        who["cool"] = int(power.get("cooldown") or 0)
        power["used"] = True
    else:
        who["cool"] = max(0, int(who.get("cool") or 0) - 1)
        power = who["ability"] if ready(who) and who.get("ability") else None
        mark = marks(fight, who)
        if mark:
            check, hurt = strike(
                fight, who, mark, who["skill"], mark["dc"], rng,
                edge=bool(power and power.get("advantage")),
                hurts=power.get("damage") if power else None,
            )
            blow.update(check=check, hit=check["passed"], at=mark["id"], atname=mark["name"])
            if power:
                blow["chose"] = str(power.get("name") or "its best")
                who["cool"] = int(power.get("cooldown") or 0)
                who["asleep"] = int(power.get("sleep") or 0)
            wound(fight, mark, hurt, blow)

    fight["blows"].append(blow)
    show_fight(turn, fight)
    turn.pop("swing", None)
    fight["turn"] += 1
    if fight["turn"] >= len(order(fight)):
        fight["turn"], fight["round"] = 0, fight["round"] + 1
        arrive(fight, rng)

    blow["us"] = [{"id": x["id"], "health": x["health"], "dead": x["dead"]} for x in fight["us"]]
    blow["them"] = [{"id": x["id"], "health": x["health"], "dead": x["dead"]} for x in fight["them"]]

    settle(fight)
    if not fight["ended"] and len(fight["blows"]) >= MAX_BLOWS:
        fight["ended"] = "broken"
    turn["state"] = "blows" if fight["ended"] else "fight"
    return campaign, turn


def arrive(fight, rng):
    """Anything called for in an earlier round turns up when its round comes."""
    owed, waiting = [], []
    for due in fight.get("owed") or []:
        (owed if due["at"] <= fight["round"] else waiting).append(due)
    for due in owed:
        come = spawn(fight, None, rng, said=due["spawn"])
        fight["blows"].append({
            "n": len(fight["blows"]) + 1, "round": fight["round"], "who": "the-world",
            "name": ", ".join(x["name"] for x in come), "side": "them",
            "chose": f"answers {due['by']}", "hit": False, "dealt": 0, "taken": 0,
            "check": None, "text": "", "arrived": True,
            "us": [{"id": x["id"], "health": x["health"], "dead": x["dead"]} for x in fight["us"]],
            "them": [{"id": x["id"], "health": x["health"], "dead": x["dead"]} for x in fight["them"]],
        })
    fight["owed"] = waiting


def soften(hurt, guard):
    """What armour is worth. It does not subtract from a blow, it divides it — so a
    great deal of defense is a great deal of good and is never quite enough."""
    kept = DEFENSE_HALVES / (DEFENSE_HALVES + max(0, int(guard or 0)))
    return max(1, round(hurt * kept))


def wound(fight, mark, hurt, blow):
    if not hurt:
        return
    raw = hurt
    hurt = soften(hurt, mark.get("defense"))
    if raw != hurt:
        blow["blocked"] = raw - hurt
    mark["health"] = max(0, mark["health"] - hurt)
    if mark["health"] <= 0:
        mark["dead"] = True
    if blow["side"] == "us":
        blow["dealt"] = hurt
    else:
        blow["taken"] = hurt
    blow["left"] = mark["health"]


def take_turn(campaign, turn, fight, me, blow, rng):
    """The explorer's turn, spent the way they said to spend it."""
    picked = turn.get("swing") or {"verb": "ATTACK", "what": None}
    verb, what = picked["verb"], picked["what"]
    blow["chose"] = verb

    if verb == "ITEM":
        blow["chose"] = f"ITEM {what['name']}"
        blow["mended"] = canon.does(what.get("effects"))
        turn.setdefault("spent", []).append(what["name"])
        me["health"] = min(me["most"], me["health"] + mended(blow, "health"))
        blow["left"] = me["health"]
        return

    if verb == "FLEE":
        check, _ = strike(fight, me, None, me["skill"], fight["flee_dc"], rng, campaign, turn)
        blow.update(check=check, hit=check["passed"])
        if check["passed"]:
            fight["ended"] = "fled"
        return

    skill = what if verb == "SKILL" else me["skill"]
    if verb == "SKILL":
        blow["chose"] = f"SKILL {what}"
    mark = still_up(fight, picked.get("mark")) or marks(fight, me)
    if not mark:
        return
    check, hurt = strike(fight, me, mark, skill, mark["dc"], rng, campaign, turn)
    blow.update(check=check, hit=check["passed"], at=mark["id"], atname=mark["name"])
    wound(fight, mark, hurt, blow)


def settle(fight):
    if fight["ended"]:
        return
    if fight["us"][0]["dead"]:
        fight["ended"] = "killed"
    elif all(x["dead"] for x in fight["them"]):
        fight["ended"] = "beaten"


def step_blows(campaign, turn):
    """One game master call to put words on a settled exchange."""
    fight = turn["fight"]
    if not turn.get("rolled"):
        roll_fate(turn)
    text, session = ask(
        prompts.gm_blows(fight, fate=turn.get("chosen"),
                         correction=turn.get("correction")),
        system=prompts.GM_SYSTEM,
        tools=READ_TOOLS,
        permission=sqlite_gate(also=("tesbota kill", "tesbota traits")),
        session=campaign["sessions"]["gm"],
        model=MODELS["gm"],
    )
    campaign["sessions"]["gm"] = session
    out = extract_json(text)
    lines = [str(x).strip() for x in (out.get("blows") or []) if str(x).strip()]
    for blow, said in zip(fight["blows"], lines):
        blow["text"] = said

    # The book keeps the whole of it; the page above the fight shows one line at
    # a time, and takes them from the blows themselves.
    draft = turn["draft"]
    draft["narration"] = "\n\n".join(
        x for x in [fight.get("said"), *lines] if x
    ).strip()
    draft["location"] = out.get("location") or draft.get("location")
    draft["transactions"] = list(draft.get("transactions") or []) + list(out.get("transactions") or [])
    for name in turn.get("spent") or []:
        draft["transactions"].append({"from": EXPLORER, "to": GODHEAD_ID, "name": name, "qty": 1})
    for key in ("quest_open", "quest_update", "quest_close"):
        draft[key] = out.get(key) or draft.get(key) or []

    me = fight["us"][0]
    mine = sum(1 for b in fight["blows"] if b["side"] == "us" and b["who"] == me["id"])
    draft["minutes"] = max(2, fight["round"] * BLOW_MINUTES)
    draft["fatigue"] = mine * BLOW_FATIGUE
    draft["health"] = me["health"] - me["most"] if me["most"] else 0
    sated = sum(mended(b, "hunger") for b in fight["blows"])
    draft["hunger"] = sated if sated else None
    draft["check"] = None
    turn["check"] = None

    told = show_fight(turn, fight)
    told["text"] = draft["narration"]
    told["status"] = "pending"
    turn["correction"] = None
    # The record was checked when the fight was declared. Swinging is the game
    # master's alone — every blow is a particular, and particulars are never
    # the lore master's to rule on.
    turn["state"] = "deliver"
    return campaign, turn


MENDED = {"health": re.compile(r"([+\-\u2212]?\d+)\s*health"),
          "hunger": re.compile(r"([+\-\u2212]?\d+)\s*hunger")}


def mended(blow, stat):
    """What a thing used mid-fight moved. The bands are written the way the world
    writes them, minus sign and all."""
    if blow.get("verb") != "ITEM" or not blow.get("mended"):
        return 0
    found = MENDED[stat].search(blow["mended"])
    return int(found.group(1).replace("\u2212", "-")) if found else 0


def plain(text):
    return " ".join((text or "").lower().split()).strip(" .,;:!?\u2014-")


def derived(entries):
    """The lore master writes the claims and rules on them in one pass. Split what
    it sends back into the claim rows and the verdicts on them."""
    claims, verdicts = [], []
    for n, entry in enumerate(entries or [], 1):
        if not isinstance(entry, dict) or not str(entry.get("text") or "").strip():
            continue
        ident = str(entry.get("id") or f"c{n}").strip() or f"c{n}"
        claims.append({
            "id": ident,
            "text": str(entry["text"]).strip(),
            "entity": canon.slug(entry.get("entity") or ""),
            "kind": str(entry.get("kind") or "places"),
        })
        verdicts.append({
            "claim": ident,
            "result": str(entry.get("result") or "WITHIN_BOUNDS").upper(),
            "why": entry.get("why") or "",
            "question": entry.get("question") or "",
            "alternative": entry.get("alternative") or "",
            "sources": entry.get("sources") or [],
        })
    return claims, verdicts


def check_record(campaign, turn, narration, roster=None, unknown=None):
    """Read the world out of a narration and rule on it. The one place the lore
    masters are asked anything, so a fight pays for it once, at its declaration."""
    read, _ = ask(
        prompts.lore1_turn(
            narration,
            where=campaign.get("location_path"),
            now=worldclock.long_stamp(campaign.get("time")),
            roster=roster,
        ),
        system=prompts.LORE1_SYSTEM,
        tools=[],
        session=None,
        model=MODELS["lore1"],
    )
    facts = [str(f).strip() for f in extract_json(read).get("facts", []) if str(f).strip()]
    turn["facts"] = facts

    text, _ = ask(
        prompts.lore2_turn(narration, facts, unknown=unknown),
        system=prompts.LORE2_SYSTEM,
        tools=READ_TOOLS,
        permission=sqlite_gate(),
        session=None,
        model=MODELS["lore2"],
    )
    ruled = extract_json(text)
    claims, verdicts = derived(ruled.get("claims", []))
    turn["draft"]["claims"] = claims

    settled = {plain(t) for t in (campaign.get("settled") or [])}
    for verdict in verdicts:
        claim = next((c for c in claims if c["id"] == verdict["claim"]), None)
        if claim and plain(claim.get("text")) in settled:
            verdict.update(result="WITHIN_BOUNDS", why="already ruled on")
    turn["verdicts"] = verdicts
    return claims, verdicts, ruled


def hold_for_lore(campaign, turn, claims, unresolved):
    """Nothing can go on until somebody writes the missing document."""
    by_id = {c["id"]: c for c in claims}
    turn["gap"] = "\n".join(
        "- "
        + ((v.get("question") or "").strip() or by_id.get(v["claim"], {}).get("text", v["claim"]))
        for v in unresolved
    )
    blocked = open_phase(turn)
    if blocked:
        blocked["status"] = "blocked"
    campaign["quiet"] = 0
    turn["state"] = "awaiting_human"
    return campaign, turn


def hold_for_bodies(campaign, turn, asked):
    """A fight naming something the world has never heard of. Nothing is rolled until
    somebody writes the creature, because what it is decides what it can take."""
    turn["gap"] = "\n".join("- " + q for q in asked)
    blocked = open_phase(turn)
    if blocked:
        blocked["status"] = "blocked"
    campaign["quiet"] = 0
    turn["state"] = "awaiting_human"
    return campaign, turn


def step_muster(campaign, turn):
    """The whole of the lore master's part in a fight. Everything it puts on the
    ground is ruled on once, here, before a die is thrown — after this the fight
    belongs to the game master and nobody checks a blow."""
    fight = turn["fight"]
    strangers = [{"id": x["id"], "name": x["name"]} for x in unbound(fight)]
    claims, verdicts, ruled = check_record(
        campaign, turn, fight.get("said") or "",
        roster=prompts.muster(fight), unknown=strangers or None,
    )

    asked = []
    for bound in ruled.get("bodies") or []:
        declared = canon.slug(bound.get("declared") or "")
        became = canon.slug(bound.get("is") or "")
        if became and canon.called(became) and rebind(fight, declared, became):
            continue
        was = next((x["name"] for x in strangers if x["id"] == declared), declared)
        asked.append((bound.get("question") or "").strip()
                     or f"does {was} exist, and what is it")
    for stray in unbound(fight):
        if not any(x["id"] == stray["id"] for x in strangers):
            continue
        if not any(stray["name"] in q or stray["id"] in q for q in asked):
            asked.append(f"does {stray['name']} exist, and what is it")
    if asked:
        show_fight(turn, fight)
        return hold_for_bodies(campaign, turn, asked)

    show_fight(turn, fight)
    unresolved = [v for v in verdicts if v.get("result") == "UNRESOLVED"]
    if unresolved:
        return hold_for_lore(campaign, turn, claims, unresolved)

    false_ones = [v for v in verdicts if v.get("result") == "FALSE"]
    if false_ones:
        if turn["gm_retries"] >= MAX_GM_RETRIES:
            turn["gap"] = (
                "The game master could not declare a fight that survives adjudication.\n\n"
                + json.dumps({"false": false_ones}, indent=2)
            )
            turn["state"] = "awaiting_human"
            return campaign, turn
        turn["gm_retries"] += 1
        turn["correction"] = json.dumps({"contradicts_the_record": false_ones}, indent=2)
        turn.pop("fight", None)
        turn["phases"] = [x for x in turn.get("phases") or [] if x.get("kind") != "fight"]
        turn["state"] = "gm"
        return campaign, turn

    turn["correction"] = None
    turn["state"] = "swing"
    return campaign, turn


def step_lore1(campaign, turn):
    draft = turn["draft"]

    if turn.get("opening"):
        claims = draft.get("claims") or []
        turn["verdicts"] = [
            {"claim": c["id"], "result": "TRUE", "why": "the world opens here"} for c in claims
        ]
        turn["state"] = "deliver"
    return campaign, turn

    narration = draft.get("narration") or ""
    claims, verdicts, _ = check_record(campaign, turn, narration)

    by_id = {c["id"]: c for c in claims}
    false_ones = [v for v in verdicts if v.get("result") == "FALSE"]
    unresolved = [v for v in verdicts if v.get("result") == "UNRESOLVED"]

    if unresolved:
        return hold_for_lore(campaign, turn, claims, unresolved)

    exhausted = too_tired(campaign, draft)
    if exhausted and not turn.get("fate") and turn["gm_retries"] < MAX_GM_RETRIES:
        vitals = campaign.get("vitals") or {}
        turn["gm_retries"] += 1
        turn["correction"] = json.dumps({
            "too_tired": {
                "fatigue_now": vitals.get("fatigue", 0),
                "this_action_would_add": draft.get("fatigue"),
                "maximum": MAX_FATIGUE,
            },
            "instruction": (
                "They are too worn out to do this. Do not narrate them doing it. "
                "Narrate that they cannot, and what resting here would take."
            ),
        }, indent=2)
        turn["state"] = redraft_state(turn)
        return campaign, turn

    if not false_ones and not turn.get("rolled") and not turn.get("looking"):
        check = roll_check(campaign, turn)
        fate = roll_fate(turn)
        payload = {}

        if check and not check["passed"]:
            payload["failed_check"] = check
            payload["check_instruction"] = (
                f"They tried and fell short: a {check['skill']} check, rolled "
                f"{check['roll']} plus {check['bonus']:+d} against a difficulty of "
                f"{check['dc']}"
                + (f", worst of {len(check['rolls'])} because they are "
                   + " and ".join(check["against"]) if check.get("against") else "")
                + ". Renarrate the same attempt not working. They may try "
                "something else afterwards, but this attempt failed."
            )
        elif check:
            payload["passed_check"] = check

        if fate:
            payload["fate"] = fate
            payload["rolled"] = turn["roll"]
            payload["die"] = DIE
            payload["fate_instruction"] = FATE_INSTRUCTIONS[fate]

        if "failed_check" in payload or fate:
            turn["correction"] = json.dumps(payload, indent=2)
            turn["state"] = redraft_state(turn)
            return campaign, turn

    if false_ones:
        if turn["gm_retries"] >= MAX_GM_RETRIES:
            turn["gap"] = (
                "The game master could not produce a draft that survives adjudication.\n\n"
                + json.dumps({"false": false_ones}, indent=2)
            )
            turn["state"] = "awaiting_human"
            return campaign, turn
        turn["gm_retries"] += 1
        turn["correction"] = json.dumps(
            {"contradicts_the_record": false_ones}, indent=2
        )
        turn["state"] = redraft_state(turn)
        return campaign, turn

    turn["state"] = "deliver"
    return campaign, turn


FATE_INSTRUCTIONS = {
    "greater_calamity": (
        "The dice have gone hard against them. Renarrate this same action, but "
        "something goes badly and lastingly wrong in the doing of it — a real injury, "
        "something lost or broken beyond mending, something dangerous arriving. Do not "
        "soften it and do not undo the action."
    ),
    "lesser_calamity": (
        "The dice have gone against them. Renarrate this same action, but it goes "
        "wrong in a small way — a setback, a fumble, time or effort spent for nothing, "
        "a minor hurt. It should sting, not maim. Do not undo the action."
    ),
    "lesser_fortune": (
        "The dice have favoured them a little. Renarrate this same action, but "
        "something small goes better than it had any right to — a thing noticed that "
        "would have been missed, an easier way, a stroke of ordinary luck."
    ),
    "greater_fortune": (
        "The dice have favoured them greatly. Renarrate this same action, but "
        "something genuinely lucky happens in the doing of it — a real find, an "
        "unlooked-for kindness, a danger that passes them by entirely. Let it matter."
    ),
}


def redraft_state(turn):
    """Where a rejected draft goes back to. A fight that has already been rolled is
    settled — the dice are not the lore master's to overturn, only the words are —
    so it goes back for different words on the same blows, never a fresh fight."""
    if (turn.get("fight") or {}).get("blows"):
        return "blows"
    if not turn.get("looking"):
        return "gm"
    return "answer"


def too_tired(campaign, draft):
    """Mid-fight this is nonsense — nobody stops swinging to be told they are weary —
    so a draft carrying a fight is never sent back for it."""
    if draft.get("fight"):
        return False
    vitals = campaign.get("vitals") or {"fatigue": 0}
    return vitals.get("fatigue", 0) + int(draft.get("fatigue") or 0) > MAX_FATIGUE


CLOSED = ("done", "failed", "abandoned")


def apply_quests(campaign, draft, turn_id):
    quests = campaign.setdefault("quests", [])
    by_id = {q["id"]: q for q in quests}

    for entry in draft.get("quest_open") or []:
        if not isinstance(entry, dict) or not entry.get("id"):
            continue
        ident = canon.slug(str(entry["id"]))
        if ident in by_id:
            continue
        quest = {
            "id": ident,
            "at": worldclock.stamp(campaign.get("time")),
            "title": str(entry.get("title") or ident.replace("-", " ")),
            "detail": str(entry.get("detail") or ""),
            "giver": str(entry.get("giver") or ""),
            "status": "active",
            "opened": turn_id,
            "closed": None,
            "where": list(campaign.get("location_path") or []),
        }
        quest["script"] = script_for(quest, campaign)
        quests.append(quest)
        by_id[ident] = quest

    for entry in draft.get("quest_update") or []:
        if not isinstance(entry, dict):
            continue
        quest = by_id.get(canon.slug(str(entry.get("id") or "")))
        if not quest or quest["status"] != "active":
            continue
        if entry.get("detail"):
            quest["detail"] = str(entry["detail"])

    for entry in draft.get("quest_close") or []:
        if isinstance(entry, dict):
            ident = canon.slug(str(entry.get("id") or ""))
            outcome = str(entry.get("outcome") or "done").lower()
        else:
            ident, outcome = canon.slug(str(entry)), "done"
        quest = by_id.get(ident)
        if not quest or quest["status"] != "active":
            continue
        quest["status"] = outcome if outcome in CLOSED else "done"
        quest["closed"] = turn_id
        quest["closed_at"] = worldclock.stamp(campaign.get("time"))
    return campaign


def script_for(quest, campaign):
    """A new errand gets a shape before the game master ever plays it. Nothing here
    is canon: it is ideation, and the walls it runs into are the point."""
    try:
        text, _ = ask(
            prompts.questmaster_turn(quest, where=campaign.get("location_path")),
            system=prompts.QUESTMASTER_SYSTEM,
            tools=READ_TOOLS,
            permission=sqlite_gate(),
            session=None,
            model=MODELS["questmaster"],
        )
        return str(extract_json(text).get("script") or "").strip()
    except Exception as exc:
        return f"the questmaster fell over: {type(exc).__name__}: {exc}"[:400]


def apply_inventory(draft, turn_id=None):
    """One ledger. `the-godhead` on either side is the world itself — where bread
    eaten goes, and where a coin found in the mud comes from."""
    for entry in draft.get("transactions") or []:
        if not isinstance(entry, dict) or not entry.get("name"):
            continue
        src = canon.slug(entry.get("from") or "")
        dst = canon.slug(entry.get("to") or "")
        canon.transfer(
            None if src in ("", GODHEAD_ID) else src,
            None if dst in ("", GODHEAD_ID) else dst,
            entry["name"],
            entry.get("qty") or 1,
            turn_id=turn_id,
        )


def settle_fight(campaign, turn):
    """A fight that outran the guard is carried with everybody's wounds on them.
    Any other ending closes it. Nought health kills, which nothing in this machine
    did before a fight could take you there."""
    fight = turn.get("fight")
    if not fight:
        return campaign
    if fight["ended"] == "broken":
        campaign["fight"] = {
            "skill": fight["skill"],
            "flee_dc": fight["flee_dc"],
            "us": [dict(x) for x in fight["us"][1:] if not x["dead"]],
            "them": [dict(x) for x in fight["them"] if not x["dead"]],
        }
    else:
        campaign["fight"] = None
    if fight["ended"] == "killed" and not pending_death():
        felled = next((b["name"] for b in reversed(fight["blows"])
                       if b["side"] == "them" and b.get("taken")), fight["name"])
        record_death(f"killed by {felled}")
    return campaign


def apply_vitals(campaign, draft):
    vitals = campaign.setdefault("vitals", {"health": MAX_HEALTH, "fatigue": 0, "hunger": 0})
    vitals["fatigue"] = max(0, min(MAX_FATIGUE, vitals.get("fatigue", 0) + int(draft.get("fatigue") or 0)))
    vitals["health"] = max(0, min(MAX_HEALTH, vitals.get("health", MAX_HEALTH) + int(draft.get("health") or 0)))

    stated = draft.get("hunger")
    drift = (int(draft.get("minutes") or 0) / 60.0) * HUNGER_PER_HOUR
    change = drift if stated is None else int(stated)
    vitals["hunger"] = max(0, min(MAX_HUNGER, round(vitals.get("hunger", 0) + change)))
    return campaign


def roll_check(campaign, turn, rng=random):
    check = (turn["draft"] or {}).get("check") or {}
    skill = (check.get("skill") or "").strip().lower()
    bonus = sheet.skill_bonus(campaign, skill)
    if bonus is None:
        return None
    dc = int(check.get("dc") or 10)
    vitals = campaign.get("vitals") or {}
    against = [
        word
        for word, level in (("spent", vitals.get("fatigue")), ("starving", vitals.get("hunger")))
        if int(level or 0) >= 100
    ]
    rolls = [rng.randint(1, SKILL_DIE) for _ in range(1 + len(against))]
    roll = min(rolls)
    outcome = {
        "skill": skill,
        "dc": dc,
        "roll": roll,
        "rolls": rolls,
        "against": against,
        "bonus": bonus,
        "total": roll + bonus,
        "passed": roll + bonus >= dc,
    }
    turn["check"] = outcome
    return outcome


BAND = re.compile(r"(\d+)\s*[–—-]\s*(\d+)|^\s*(\d+)\s*$")


def band(said, rng=random):
    """A damage band the way the item table writes one — `1–2`, `2-5`, or a bare
    number. Anything that does not read as one is a bare-handed blow."""
    found = BAND.search(str(said or ""))
    if not found:
        found = BAND.search(UNARMED)
    if found.group(3):
        return int(found.group(3))
    low, high = int(found.group(1)), int(found.group(2))
    return rng.randint(min(low, high), max(low, high))


def swung_with(campaign):
    """What they are holding. Worn, a weapon, and carrying a damage band — anything
    else and they are swinging a fist, which is no worse than a stick."""
    for held in canon.holdings(EXPLORER):
        if held.get("worn") and held.get("type") == "weapon":
            hurt = next((e["amount"] for e in held.get("effects") or [] if e["stat"] == "damage"), None)
            if hurt:
                return held.get("name"), str(hurt)
    return "bare hands", UNARMED


def chosen_blow(said, campaign, fight=None):
    """One word back from the explorer, read the way an action is read. Anything that
    does not parse is a swing, because a body in a fight does not stand still."""
    first = (said or "").strip().splitlines()
    head = (first[0] if first else "").strip().strip("\"\'`*").strip()
    upper = head.upper()
    if upper.startswith("FLEE"):
        return {"verb": "FLEE", "what": None}
    if upper.startswith("ITEM"):
        want = canon.slug(head[4:])
        item = next((h for h in usable(campaign) if canon.slug(h["name"]) == want), None)
        return {"verb": "ITEM", "what": item} if item else {"verb": "ATTACK", "what": None}
    if upper.startswith("SKILL"):
        name = " ".join(head[5:].split()).lower().strip(":- ")
        if sheet.skill_bonus(campaign, name) is not None:
            return {"verb": "SKILL", "what": name, "mark": aimed(head, fight)}
    return {"verb": "ATTACK", "what": None, "mark": aimed(head, fight)}


def aimed(head, fight):
    """`ATTACK the rat mother` picks its mark, and picks it by id. Naming nobody
    leaves the choosing to the driver, which goes for whoever is closest to dropping."""
    if not fight:
        return None
    want = canon.slug(head.split(None, 1)[1]) if len(head.split(None, 1)) > 1 else ""
    if not want:
        return None
    found = next((x for x in fight["them"]
                  if not x["dead"] and (x["id"] == want or canon.slug(x["name"]) == want)), None)
    return found["id"] if found else None


def still_up(fight, want):
    """The body a stored choice names, found again in the fight as it stands. What
    the explorer picked is written to disk between the asking and the swing, so
    keeping hold of the body itself swings at a copy and throws the wound away."""
    if isinstance(want, dict):
        want = want.get("id")
    if not want:
        return None
    return next((x for x in fight["them"] if x["id"] == want and not x["dead"]), None)


def said_blow(blow):
    """The one line the explorer is handed before being asked again."""
    who = blow.get("name") or "somebody"
    if blow.get("chose") == "ASLEEP":
        return f"{who} does not stir."
    if blow.get("spawned"):
        return f"{who} {blow['chose']} — {blow['spawned']} is on you as well."
    if blow["side"] == "us" and blow.get("chose", "").startswith("ITEM"):
        return f"{who} used the {blow['chose'][5:]}."
    if blow.get("chose") == "FLEE":
        return "You got clear." if blow["hit"] else "You could not break away."
    if blow["side"] == "us":
        return (f"{who} landed it on {blow.get('atname')} — {blow['dealt']} off it."
                if blow["hit"] else f"{who} missed {blow.get('atname')}.")
    if blow["hit"]:
        return f"{who} got {blow['taken']} into {blow.get('atname')}."
    return f"{who} came at {blow.get('atname')} and missed."


def roll_fate(turn, rng=random):
    roll = rng.randint(1, DIE)
    turn["roll"] = roll
    turn["rolled"] = True

    if roll <= 1:
        fate = "greater_calamity"
    elif roll <= 2:
        fate = "lesser_calamity"
    elif roll > DIE - 1:
        fate = "greater_fortune"
    elif roll > DIE - 2:
        fate = "lesser_fortune"
    else:
        fate = None

    turn["fate"] = fate
    return fate


def step_deliver(campaign, turn):
    """Everything a turn changes about the world, applied in one place. Nothing
    above it writes to the campaign, so a turn that never reaches here leaves no
    mark — which is what makes a rejected draft safe to throw away."""
    if turn.get("delivered"):
        turn["state"] = "done"
        return campaign, turn

    draft = turn["draft"]

    campaign = apply_vitals(campaign, draft)
    apply_inventory(draft, turn["turn_id"])
    campaign = apply_quests(campaign, draft, turn["turn_id"])
    campaign = settle_fight(campaign, turn)

    where = (draft.get("location") or "").strip() if isinstance(draft.get("location"), str) else ""
    if where:
        campaign["location"] = canon.slug(where.strip("[]"))
        canon.ensure_entity("places", campaign["location"], turn_id=turn["turn_id"])
        campaign["location_path"] = canon.ancestry(campaign["location"])

    campaign["time"] = worldclock.advance(campaign.get("time"), draft.get("minutes"))
    campaign["time"]["stamp"] = worldclock.stamp(campaign["time"])
    campaign["time"]["long"] = worldclock.long_stamp(campaign["time"])
    turn["at"] = campaign["time"]["long"]
    campaign["last_narration"] = draft.get("narration")
    by_verdict = {v["claim"]: v for v in turn["verdicts"]}
    current = open_phase(turn)
    if current is None and draft.get("narration"):
        current = phase(turn, "gm", "world", draft.get("narration"))
    if current:
        current["status"] = "checked"
        current["claims"] = [
            {**claim, "verdict": by_verdict.get(claim.get("id"))}
            for claim in (draft.get("claims") or [])
        ]
        if current["kind"] in ("outcome", "world"):
            current["minutes"] = int(draft.get("minutes") or 0)
            current["fatigue"] = int(draft.get("fatigue") or 0)
            current["roll"] = turn.get("roll")
            current["outcomes"] = turn.get("outcomes") or []
            current["chosen"] = turn.get("chosen")
            current["fortune"] = turn.get("fortune")
            current["transactions"] = draft.get("transactions") or []
            current["check"] = turn.get("check")
    turn["location_path"] = campaign.get("location_path") or []
    turn["vitals"] = dict(campaign.get("vitals") or {})
    active = next((q for q in campaign.get("quests") or [] if q.get("status") == "active"), None)
    turn["quest"] = active.get("title") if active else None

    if turn.get("looking"):
        mode = turn.get("mode")
        bucket = {"say": "talks", "look": "looks"}.get(mode, "context")
        turn.setdefault(bucket, []).append({
            "question": turn.get("question"),
            "answer": draft.get("narration"),
        })
        turn["looking"] = False
        turn["mode"] = None
        turn["question"] = None
        turn["draft"] = None
        turn["verdicts"] = []
        turn["gm_retries"] = 0
        turn["state"] = "explorer"
        return campaign, turn

    if (turn.get("arrival") or turn.get("event")) and not turn.get("action"):
        turn["minutes"] = int(draft.get("minutes") or 0)
        turn["draft"] = None
        turn["verdicts"] = []
        turn["gm_retries"] = 0
        turn["state"] = "explorer"
        return campaign, turn

    turn["minutes"] = int(draft.get("minutes") or 0)
    campaign["quiet"] = campaign.get("quiet", 0) + 1
    campaign["calm"] = 0 if turn.get("pressed") else campaign.get("calm", 0) + 1
    turn["resolved"] = True
    turn["draft"] = None
    turn["verdicts"] = []
    turn["gm_retries"] = 0
    turn["state"] = "explorer"
    return campaign, turn


STEPS = {
    "explorer": step_explorer,
    "answer": step_answer,
    "propose": step_propose,
    "gm": step_gm,
    "muster": step_muster,
    "swing": step_swing,
    "fight": step_fight,
    "blows": step_blows,
    "lore1": step_lore1,
    "deliver": step_deliver,
    "narrate": step_narrate,
}
