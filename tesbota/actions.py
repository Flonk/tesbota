import threading

from . import canon, driver, prompts, view
from .gate import sqlite_gate
from .config import MODELS, MYSTERY, STATE, WRITE_TOOLS
from .sdk import ask
from .state import (
    all_turns,
    load_campaign,
    load_turn,
    now,
    parse,
    read_json,
    record_death,
    save_campaign,
    write_json,
)

CHAT_FILE = STATE / "lore3.json"
LOCK = threading.Lock()


def chat_log():
    return read_json(CHAT_FILE) if CHAT_FILE.exists() else []


def append_chat(role, text):
    log = chat_log()
    log.append({"role": role, "text": text})
    write_json(CHAT_FILE, log)


def say(text):
    with LOCK:
        campaign = load_campaign()
        turn = load_turn(campaign["current_turn"])
        if turn["state"] != "awaiting_human":
            return {"error": "nothing is pending"}
        session = campaign["sessions"].get("lore3_sitting")
        message = text if session else prompts.lore3_turn(turn.get("gap") or "") + "\n\n" + text
        append_chat("you", text)

    reply, session = ask(
        message,
        system=prompts.LORE3_SYSTEM,
        tools=WRITE_TOOLS,
        permission=sqlite_gate(readonly=False),
        session=session,
        model=MODELS["lore3"],
    )

    lines = [line for line in reply.strip().splitlines() if line.strip()]
    finished = bool(lines) and lines[-1].strip() == "RESOLVED"
    if finished:
        reply = "\n".join(reply.strip().splitlines()[:-1]).rstrip()

    with LOCK:
        campaign = load_campaign()
        campaign["sessions"]["lore3_sitting"] = session
        save_campaign(campaign)
        append_chat("lore master", reply)

    illegal = canon.illegal_books()
    if finished and illegal:
        finished = False
        note = (
            "Not resolved. These books are attributed to the one moving through this "
            "world, which is not an author: " + ", ".join(illegal) + ". "
            "Direct observation is not testimony. Remove or reattribute them, then finish."
        )
        with LOCK:
            append_chat("driver", note)
        return {"reply": reply, "resolved": False, "rejected": note}

    if finished:
        resolve()
    return {"reply": reply, "resolved": finished}


def set_note(text):
    with LOCK:
        campaign = load_campaign()
        campaign["note"] = (text or "").strip() or None
        save_campaign(campaign)
    return {"ok": True, "note": campaign["note"]}


def resolve():
    with LOCK:
        campaign = load_campaign()
        turn = load_turn(campaign["current_turn"])
        if turn["state"] != "awaiting_human":
            return {"error": "nothing is pending"}
        campaign["sessions"]["lore3_sitting"] = None
        save_campaign(campaign)

        canon.link_writing()

        transcript = chat_log()
        if transcript:
            turn["lore"] = (turn.get("lore") or []) + transcript
        turn["lore_gap"] = turn.get("gap") or turn.get("lore_gap")

        driver.resolve_gap(campaign, turn)
        write_json(CHAT_FILE, [])

    with LOCK:
        try:
            state, turn = driver.run(limit=1)
        except Exception as exc:
            campaign = load_campaign()
            return {"ok": True, "error": f"{type(exc).__name__}: {exc}"[:600],
                    "turn": campaign.get("current_turn")}
    return {"ok": True, "state": state, "turn": turn["turn_id"]}


def kill(cause=None):
    """Ask for a death. The driver carries it out, because the game master may be
    calling for one in the middle of a turn that still has to be written."""
    with LOCK:
        return {"ok": True, "cause": record_death(cause or MYSTERY)}


def step():
    with LOCK:
        try:
            state, turn = driver.run(limit=1)
        except Exception as exc:
            campaign = load_campaign()
            return {"error": f"{type(exc).__name__}: {exc}"[:600], "turn": campaign.get("current_turn")}
    return {"state": state, "turn": turn["turn_id"]}
