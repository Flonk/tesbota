import json

from . import canon, prompts, quotes
from .config import MAX_GM_RETRIES, MODELS, OPENING, READ_TOOLS, WRITE_TOOLS
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


def deliver(campaign, turn):
    draft = turn["draft"]
    kept = {v["claim"] for v in turn["verdicts"] if v.get("result") in ("TRUE", "FRICTION")}
    for claim in draft.get("claims") or []:
        if claim["id"] in kept and claim.get("entity"):
            canon.append_witnessed(
                claim["entity"], turn["turn_id"], claim["text"], kind=claim.get("kind", "places")
            )
    campaign["last_narration"] = draft.get("narration")
    turn["state"] = "done"
    return campaign, turn


STEPS = {
    "explorer": step_explorer,
    "gm": step_gm,
    "lore1": step_lore1,
}
