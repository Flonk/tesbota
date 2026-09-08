import threading

from . import canon, chronicle, driver, prompts, view
from .gate import sqlite_gate
from .config import EXPLORER, MODELS, STARTING_INVENTORY, STATE, WRITE_TOOLS
from .sdk import ask
from .state import (
    all_turns,
    explorer_name,
    load_campaign,
    load_turn,
    new_campaign,
    now,
    parse,
    pick_name,
    read_json,
    retire,
    save_campaign,
    stock,
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


def reborn():
    """End this life and set another walking in the same world. The world keeps
    everything it has been told; only the one walking through it is new."""
    with LOCK:
        campaign = load_campaign()
        gone = explorer_name(campaign)
        fell = campaign.get("location")
        if fell:
            for item in canon.holdings(EXPLORER):
                canon.give(fell, item["name"], item["qty"], note=item.get("note") or "")
        canon.strip(EXPLORER)

        retire(campaign)
        write_json(CHAT_FILE, [])

        life = new_campaign()
        life["explorer"] = pick_name()
        life["time"] = campaign.get("time") or life["time"]
        life["clock"] = campaign.get("clock") or life["clock"]
        save_campaign(life)
        stock(STARTING_INVENTORY)

        try:
            turn = driver.open_world(life)
            chronicle.ensure_book(turn["turn_id"])
        except Exception as exc:
            return {"ok": True, "gone": gone, "explorer": life["explorer"],
                    "error": f"{type(exc).__name__}: {exc}"[:600]}
    return {"ok": True, "gone": gone, "explorer": life["explorer"], "turn": turn["turn_id"]}


def step():
    with LOCK:
        try:
            state, turn = driver.run(limit=1)
        except Exception as exc:
            campaign = load_campaign()
            return {"error": f"{type(exc).__name__}: {exc}"[:600], "turn": campaign.get("current_turn")}
    return {"state": state, "turn": turn["turn_id"]}
