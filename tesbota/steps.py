import json

from . import canon, prompts, quotes
import random

from .config import (
    BASE_RISK,
    MAX_ASKS,
    MAX_FATIGUE,
    MAX_GM_RETRIES,
    MAX_HEALTH,
    MAX_RISK,
    MODELS,
    OPENING,
    READ_TOOLS,
    TRIVIAL_FATIGUE,
    TRIVIAL_MINUTES,
    WRITE_TOOLS,
)
from .sdk import ask, extract_json


def step_explorer(campaign, turn):
    text, session = ask(
        prompts.explorer_turn(campaign.get("last_narration")),
        system=prompts.EXPLORER_SYSTEM,
        tools=[],
        session=campaign["sessions"]["explorer"],
        model=MODELS["explorer"],
    )
    campaign["sessions"]["explorer"] = session
    turn["action"] = text
    turn["state"] = "propose"
    return campaign, turn


def step_propose(campaign, turn):
    text, session = ask(
        prompts.gm_propose(
            turn.get("action"),
            previous=campaign.get("last_narration"),
            vitals=campaign.get("vitals"),
            answers=turn.get("answers") or [],
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

    trivial = (
        priced
        and proposal["minutes"] < TRIVIAL_MINUTES
        and abs(proposal["fatigue"]) < TRIVIAL_FATIGUE
    )
    turn["confirmed"] = True if trivial else None
    turn["state"] = "gm" if trivial else "confirm"
    return campaign, turn


def step_confirm(campaign, turn):
    text, session = ask(
        prompts.explorer_confirm(turn["proposal"]),
        system=prompts.EXPLORER_SYSTEM,
        tools=[],
        session=campaign["sessions"]["explorer"],
        model=MODELS["explorer"],
    )
    campaign["sessions"]["explorer"] = session
    turn["answer"] = text
    first = text.strip().splitlines()[0].strip().upper() if text.strip() else ""
    yes = first.startswith("YES")
    turn["confirmed"] = yes
    if yes:
        turn["state"] = "gm"
        return campaign, turn

    turn["declines"] = turn.get("declines", 0) + 1
    if turn["declines"] >= MAX_ASKS:
        turn["gap"] = (
            "The adventurer has refused every proposal put to them:\n\n"
            + text.strip()
        )
        turn["state"] = "awaiting_human"
        return campaign, turn

    turn["action"] = text
    turn["proposal"] = None
    turn["answers"] = []
    turn["state"] = "propose"
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
    draft.setdefault("risk", BASE_RISK)

    agreed = turn.get("proposal") if turn.get("confirmed") else None
    if agreed:
        draft["minutes"] = agreed["minutes"]
        draft["fatigue"] = agreed["fatigue"]
        draft["risk"] = max(draft.get("risk") or BASE_RISK, agreed.get("risk") or BASE_RISK)
    turn["draft"] = draft
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
        turn["state"] = "awaiting_human"
        return campaign, turn

    bad_quotes = quotes.verify(draft.get("quotes"))

    exhausted = too_tired(campaign, draft)
    if exhausted and not turn.get("calamity") and turn["gm_retries"] < MAX_GM_RETRIES:
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
        turn["state"] = "gm"
        return campaign, turn

    if not (false_ones or bad_quotes) and not turn.get("rolled"):
        if roll_for_calamity(turn):
            turn["calamity"] = True
            turn["correction"] = json.dumps({
                "calamity": {
                    "rolled": turn["roll"],
                    "needed_above": 100 - turn["risk"],
                    "risk": turn["risk"],
                },
                "instruction": (
                    "The dice have gone against them. Renarrate this same action, but "
                    "something goes badly wrong in the doing of it. Make it real and make "
                    "it cost something — an injury, a loss, something breaking, something "
                    "arriving. Do not soften it and do not undo the action."
                ),
            }, indent=2)
            turn["state"] = "gm"
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
        turn["state"] = "gm"
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
        turn["state"] = "gm"
        return campaign, turn

    return deliver(campaign, turn)


def too_tired(campaign, draft):
    vitals = campaign.get("vitals") or {"fatigue": 0}
    return vitals.get("fatigue", 0) + int(draft.get("fatigue") or 0) > MAX_FATIGUE


def apply_vitals(campaign, draft):
    vitals = campaign.setdefault("vitals", {"health": MAX_HEALTH, "fatigue": 0})
    vitals["fatigue"] = max(0, min(MAX_FATIGUE, vitals.get("fatigue", 0) + int(draft.get("fatigue") or 0)))
    vitals["health"] = max(0, min(MAX_HEALTH, vitals.get("health", MAX_HEALTH) + int(draft.get("health") or 0)))
    return campaign


def roll_for_calamity(turn, rng=random):
    draft = turn["draft"]
    risk = max(BASE_RISK, min(MAX_RISK, int(draft.get("risk") or BASE_RISK)))
    roll = rng.randint(1, 100)
    turn["roll"] = roll
    turn["risk"] = risk
    turn["rolled"] = True
    return roll > 100 - risk


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

    turn["delivered"] = True
    campaign = apply_vitals(campaign, draft)
    campaign["last_narration"] = draft.get("narration")
    turn["minutes"] = int(draft.get("minutes") or 0)
    turn["state"] = "done"
    return campaign, turn


STEPS = {
    "explorer": step_explorer,
    "propose": step_propose,
    "confirm": step_confirm,
    "gm": step_gm,
    "lore1": step_lore1,
}
