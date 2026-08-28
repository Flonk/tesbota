import threading

from . import canon, driver, prompts, view
from .config import MODELS, STATE, WRITE_TOOLS
from .sdk import ask
from .state import (
    all_turns,
    load_campaign,
    load_turn,
    now,
    parse,
    read_json,
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


def snapshot():
    campaign = load_campaign()
    turn_id = campaign.get("current_turn")
    turn = load_turn(turn_id) if turn_id else None

    story, machinery = [], []
    for t in all_turns():
        draft = t.get("draft") or {}
        cue = None
        if t.get("arrival"):
            cue = f"arrives at {t['arrival']}"
        elif t.get("event"):
            cue = "something on the road"
        if t.get("action") or draft.get("narration") or cue:
            story.append({
                "id": t["turn_id"],
                "cue": cue,
                "action": t.get("action"),
                "narration": draft.get("narration"),
            })
        if draft.get("claims") or t.get("verdicts") or t.get("correction"):
            machinery.append({
                "id": t["turn_id"],
                "claims": draft.get("claims") or [],
                "verdicts": t.get("verdicts") or [],
                "quotes": draft.get("quotes") or [],
                "correction": t.get("correction"),
                "retries": t.get("gm_retries", 0),
                "travel": draft.get("travel"),
            })

    status = {"state": turn["state"] if turn else "uninitialised", "turn": turn_id}
    if turn and turn.get("wake_at"):
        status["destination"] = turn.get("destination")
        status["wakesIn"] = view.duration(parse(turn["wake_at"]) - now())
        status["events"] = sum(1 for e in turn.get("schedule", []) if not e["fired"])
    if campaign.get("suspended_journey"):
        status["held"] = campaign["suspended_journey"].get("destination")

    gap = None
    if turn and turn["state"] == "awaiting_human":
        gap = {"turn": turn["turn_id"], "text": turn.get("gap") or ""}

    return {"status": status, "story": story, "machinery": machinery, "gap": gap, "chat": chat_log()}


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


def resolve():
    with LOCK:
        campaign = load_campaign()
        turn = load_turn(campaign["current_turn"])
        if turn["state"] != "awaiting_human":
            return {"error": "nothing is pending"}
        campaign["sessions"]["lore3_sitting"] = None
        save_campaign(campaign)
        driver.resolve_gap(campaign, turn)
        write_json(CHAT_FILE, [])
    return {"ok": True}


def step():
    with LOCK:
        state, turn = driver.run(limit=1)
    return {"state": state, "turn": turn["turn_id"]}
