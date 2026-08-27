import json

from . import canon, prompts, quotes
import random

from .config import (
    BASE_RISK,
    MAX_FATIGUE,
    MAX_GM_RETRIES,
    MAX_HEALTH,
    MAX_RISK,
    MODELS,
    OPENING,
    READ_TOOLS,
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
    draft = turn["draft"]
    kept = {v["claim"] for v in turn["verdicts"] if v.get("result") in ("TRUE", "FRICTION")}
    for claim in draft.get("claims") or []:
        if claim["id"] in kept and claim.get("entity"):
            canon.append_witnessed(
                claim["entity"], turn["turn_id"], claim["text"], kind=claim.get("kind", "places")
            )
    campaign = apply_vitals(campaign, draft)
    campaign["last_narration"] = draft.get("narration")
    turn["minutes"] = int(draft.get("minutes") or 0)
    turn["state"] = "done"
    return campaign, turn


STEPS = {
    "explorer": step_explorer,
    "gm": step_gm,
    "lore1": step_lore1,
}
