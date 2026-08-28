import json

from . import canon, prompts, quotes, sheet, worldclock
import random

from .config import (
    BASE_RISK,
    DIE,
    MAX_ASKS,
    MAX_LOOKS,
    MAX_TALKS,
    MAX_FATIGUE,
    MAX_GM_RETRIES,
    HUNGER_PER_HOUR,
    MAX_HEALTH,
    MAX_HUNGER,
    MAX_RISK,
    MODELS,
    SKILL_DIE,
    OPENING,
    READ_TOOLS,
    TRIVIAL_FATIGUE,
    TRIVIAL_MINUTES,
    WRITE_TOOLS,
)
from .sdk import ask, extract_json


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


EXPLORER_COMMANDS = ("tesbota stats", "tesbota inventory")


def normalise_command(text):
    parts = (text or "").strip().split()
    if parts[:2] == ["uv", "run"]:
        parts = parts[2:]
    return " ".join(parts)


async def explorer_permission(tool_name, tool_input, context):
    from claude_agent_sdk import PermissionResultAllow, PermissionResultDeny

    if tool_name != "Bash":
        return PermissionResultDeny(
            message="You have no such power. You may run tesbota stats or tesbota inventory."
        )
    raw = (tool_input or {}).get("command") or ""
    if any(ch in raw for ch in ";|&$`><\n"):
        return PermissionResultDeny(message="Nothing happens.")

    command = normalise_command(raw)
    if command in EXPLORER_COMMANDS:
        return PermissionResultAllow()
    if command.split()[:2] == ["tesbota", "notebook"]:
        return PermissionResultAllow()
    return PermissionResultDeny(
        message=(
            "Nothing happens. The only things you can do are `tesbota stats`, "
            "`tesbota inventory` and `tesbota notebook`."
        )
    )


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
    return " ".join(kept).strip()


def step_explorer(campaign, turn):
    text, session = ask(
        prompts.explorer_turn(campaign.get("last_narration"), nudge=turn.get("nudge")),
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

    if upper.startswith("LOOK:") and len(turn.get("looks") or []) < MAX_LOOKS:
        turn["question"] = stripped[5:].strip()
        turn["mode"] = "look"
        turn["looking"] = True
        phase(turn, "explorer", "look", turn["question"])
        turn["state"] = "answer"
        return campaign, turn

    if upper.startswith("SAY:") and len(turn.get("talks") or []) < MAX_TALKS:
        turn["question"] = stripped[4:].strip()
        turn["mode"] = "say"
        turn["looking"] = True
        phase(turn, "explorer", "say", turn["question"])
        turn["state"] = "answer"
        return campaign, turn

    for prefix in ("LOOK:", "SAY:"):
        if upper.startswith(prefix):
            stripped = stripped[len(prefix):].strip()
            break

    turn["ready"] = stripped
    if turn.get("resolved"):
        turn["delivered"] = True
        turn["state"] = "done"
    else:
        turn["state"] = "propose"
    return campaign, turn


def step_answer(campaign, turn):
    text, session = ask(
        prompts.gm_answer(
            turn.get("question"),
            previous=campaign.get("last_narration"),
            mode=turn.get("mode") or "look",
            inventory=campaign.get("inventory") or [],
            correction=turn.get("correction"),
        ),
        system=prompts.GM_SYSTEM,
        tools=READ_TOOLS,
        session=campaign["sessions"]["gm"],
        model=MODELS["gm"],
    )
    campaign["sessions"]["gm"] = session
    draft = extract_json(text)
    draft.setdefault("claims", [])
    draft.setdefault("quotes", [])
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
            inventory=campaign.get("inventory") or [],
        
            now=worldclock.long_stamp(campaign.get("time")),
        ),
        system=prompts.GM_PROPOSE_SYSTEM,
        tools=READ_TOOLS,
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
            "risk": BASE_RISK,
            "unpriced": True,
        }

    proposal.setdefault("summary", turn.get("action") or "")
    proposal["minutes"] = int(proposal.get("minutes") or 0)
    proposal["fatigue"] = int(proposal.get("fatigue") or 0)
    proposal["risk"] = int(proposal.get("risk") or BASE_RISK)
    turn["proposal"] = proposal

    turn["confirmed"] = True
    turn["state"] = "gm"
    return campaign, turn


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
            arrival=turn.get("arrival"),
            agreed=turn.get("proposal") if turn.get("confirmed") else None,
            note=turn.get("note"),
            inventory=campaign.get("inventory") or [],
            quests=campaign.get("quests") or [],
        
            now=worldclock.long_stamp(campaign.get("time")),
        ),
        system=prompts.GM_SYSTEM,
        tools=READ_TOOLS,
        session=campaign["sessions"]["gm"],
        model=MODELS["gm"],
    )
    campaign["sessions"]["gm"] = session
    draft = extract_json(text)
    draft.setdefault("claims", [])
    draft.setdefault("quotes", [])
    draft.setdefault("travel", None)
    draft.setdefault("minutes", 0)
    draft.setdefault("fatigue", 0)
    draft.setdefault("health", 0)
    draft.setdefault("hunger", None)
    draft.setdefault("check", None)
    draft.setdefault("location", None)
    draft.setdefault("gain", [])
    draft.setdefault("lose", [])
    draft.setdefault("quest_open", [])
    draft.setdefault("quest_close", [])
    draft.setdefault("risk", BASE_RISK)

    agreed = turn.get("proposal") if turn.get("confirmed") else None
    if agreed:
        draft["minutes"] = agreed["minutes"]
        draft["fatigue"] = agreed["fatigue"]
        draft["risk"] = max(draft.get("risk") or BASE_RISK, agreed.get("risk") or BASE_RISK)
    turn["draft"] = draft
    world = (turn.get("arrival") or turn.get("event")) and not turn.get("action")
    gm_phase(turn, "world" if world else "outcome", draft.get("narration"))
    turn["correction"] = None
    turn["state"] = "lore1"
    return campaign, turn


def step_lore1(campaign, turn):
    draft = turn["draft"]
    claims = draft.get("claims") or []

    if turn.get("opening"):
        turn["verdicts"] = [
            {"claim": c["id"], "result": "TRUE", "why": "the world opens here"} for c in claims
        ]
        return deliver(campaign, turn)

    verdicts = []
    if claims:
        text, _ = ask(
            prompts.lore1_turn(claims),
            system=prompts.LORE1_SYSTEM,
            tools=WRITE_TOOLS,
            session=None,
            model=MODELS["lore1"],
        )
        verdicts = extract_json(text).get("verdicts", [])
    turn["verdicts"] = verdicts

    by_id = {c["id"]: c for c in claims}
    false_ones = [v for v in verdicts if v.get("result") == "FALSE"]
    unresolved = [v for v in verdicts if v.get("result") == "UNRESOLVED"]

    if unresolved:
        turn["gap"] = "\n".join(
            f"- {by_id.get(v['claim'], {}).get('text', v['claim'])}\n  ({v.get('why', '')})"
            for v in unresolved
        )
        blocked = open_phase(turn)
        if blocked:
            blocked["status"] = "blocked"
        turn["state"] = "awaiting_human"
        return campaign, turn

    bad_quotes = quotes.verify(draft.get("quotes"))

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

    if not (false_ones or bad_quotes) and not turn.get("rolled") and not turn.get("looking"):
        check = roll_check(campaign, turn)
        fate = roll_fate(turn)
        payload = {}

        if check and not check["passed"]:
            payload["failed_check"] = check
            payload["check_instruction"] = (
                f"They tried and fell short: a {check['skill']} check, rolled "
                f"{check['roll']} plus {check['bonus']:+d} against a difficulty of "
                f"{check['dc']}. Renarrate the same attempt not working. They may try "
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

    frictions = [v for v in verdicts if v.get("result") == "FRICTION"]
    if frictions and not turn.get("friction_bounced") and not false_ones and not bad_quotes:
        turn["friction_bounced"] = True
        turn["gm_retries"] += 1
        turn["correction"] = json.dumps({
            "friction": [
                {
                    "claim": by_id.get(v["claim"], {}).get("text", v["claim"]),
                    "rubs_against": v.get("why"),
                }
                for v in frictions
            ],
            "instruction": (
                "These rub against something already written down. Contradiction is "
                "allowed in this world — its authors disagree constantly — but it must be "
                "deliberate, not accidental. Either renarrate so it sits with the record, "
                "or keep it and make the discrepancy part of what happens: the text is "
                "wrong, or out of date, or its author lied, and that is worth noticing. "
                "Do not silently differ. If you keep it, it stands."
            ),
        }, indent=2)
        turn["state"] = redraft_state(turn)
        return campaign, turn

    if false_ones or bad_quotes:
        if turn["gm_retries"] >= MAX_GM_RETRIES:
            turn["gap"] = (
                "The game master could not produce a draft that survives adjudication.\n\n"
                + json.dumps({"false": false_ones, "quotes": bad_quotes}, indent=2)
            )
            turn["state"] = "awaiting_human"
            return campaign, turn
        turn["gm_retries"] += 1
        turn["correction"] = json.dumps(
            {"contradicts_witnessed": false_ones, "bad_quotes": bad_quotes}, indent=2
        )
        turn["state"] = redraft_state(turn)
        return campaign, turn

    return deliver(campaign, turn)


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
    if not turn.get("looking"):
        return "gm"
    return "answer"


def too_tired(campaign, draft):
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
        quests.append(quest)
        by_id[ident] = quest

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


def apply_inventory(campaign, draft):
    items = campaign.setdefault("inventory", [])

    for entry in draft.get("lose") or []:
        name = (entry.get("name") if isinstance(entry, dict) else str(entry) or "").strip().lower()
        qty = int((entry.get("qty") if isinstance(entry, dict) else 1) or 1)
        for held in list(items):
            if str(held.get("name", "")).strip().lower() != name:
                continue
            held["qty"] = int(held.get("qty") or 1) - qty
            if held["qty"] <= 0:
                items.remove(held)
            break

    for entry in draft.get("gain") or []:
        if not isinstance(entry, dict) or not entry.get("name"):
            continue
        name = str(entry["name"]).strip()
        qty = int(entry.get("qty") or 1)
        existing = next((h for h in items if str(h.get("name", "")).strip().lower() == name.lower()), None)
        if existing:
            existing["qty"] = int(existing.get("qty") or 1) + qty
        else:
            items.append({
                "name": name,
                "qty": qty,
                "note": str(entry.get("note") or ""),
                "worn": bool(entry.get("worn")),
            })
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
    roll = rng.randint(1, SKILL_DIE)
    outcome = {
        "skill": skill,
        "dc": dc,
        "roll": roll,
        "bonus": bonus,
        "total": roll + bonus,
        "passed": roll + bonus >= dc,
    }
    turn["check"] = outcome
    return outcome


def roll_fate(turn, rng=random):
    draft = turn["draft"]
    risk = max(BASE_RISK, min(MAX_RISK, int(draft.get("risk") or BASE_RISK)))
    roll = rng.randint(1, DIE)
    turn["roll"] = roll
    turn["risk"] = risk
    turn["rolled"] = True

    if roll <= risk:
        fate = "greater_calamity"
    elif roll <= 2 * risk:
        fate = "lesser_calamity"
    elif roll > DIE - 1:
        fate = "greater_fortune"
    elif roll > DIE - 2:
        fate = "lesser_fortune"
    else:
        fate = None

    turn["fate"] = fate
    return fate


def deliver(campaign, turn):
    if turn.get("delivered"):
        turn["state"] = "done"
        return campaign, turn

    draft = turn["draft"]
    results = {v["claim"]: v.get("result") for v in turn["verdicts"]}
    for claim in draft.get("claims") or []:
        result = results.get(claim["id"])
        if not claim.get("entity"):
            continue
        kind = claim.get("kind", "places")
        if result in ("TRUE", "WITHIN_BOUNDS"):
            canon.append_witnessed(claim["entity"], turn["turn_id"], claim["text"], kind=kind)
        elif result == "FRICTION":
            canon.append_attested(claim["entity"], turn["turn_id"], claim["text"], kind=kind)

    campaign = apply_vitals(campaign, draft)
    campaign = apply_inventory(campaign, draft)
    campaign = apply_quests(campaign, draft, turn["turn_id"])

    where = (draft.get("location") or "").strip() if isinstance(draft.get("location"), str) else ""
    if where:
        campaign["location"] = canon.slug(where.strip("[]"))
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
            current["risk"] = turn.get("risk")
    turn["location_path"] = campaign.get("location_path") or []
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
    "lore1": step_lore1,
}
