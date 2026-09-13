from .state import all_turns, now, parse

DIM = "\033[2m"
BOLD = "\033[1m"
WARN = "\033[33m"
OFF = "\033[0m"


def duration(delta):
    seconds = max(0, int(delta.total_seconds()))
    hours, minutes = seconds // 3600, (seconds % 3600) // 60
    if hours and minutes:
        return f"{hours}h {minutes}m"
    if hours:
        return f"{hours}h"
    return f"{minutes}m"


def wrap(text, width=76, indent="  "):
    words, lines, line = (text or "").split(), [], ""
    for word in words:
        if len(line) + len(word) + 1 > width:
            lines.append(indent + line)
            line = word
        else:
            line = f"{line} {word}".strip()
    if line:
        lines.append(indent + line)
    return "\n".join(lines)


def beats(turns):
    for turn in turns:
        cue = None
        if turn.get("arrival"):
            cue = f"arrives at {turn['arrival']}"
        elif turn.get("event"):
            cue = "something on the road"
        narration = (turn.get("draft") or {}).get("narration")
        yield turn, cue, turn.get("action"), narration


def render_log(turns, since=None):
    out = []
    for turn, cue, action, narration in beats(turns):
        if not (action or narration or cue):
            continue
        mark = " *" if since and turn["turn_id"] > since else ""
        out.append(f"{DIM}── {turn['turn_id']}{mark}{OFF}")
        if cue:
            out.append(f"{DIM}   {cue}{OFF}")
        if action:
            out.append(f"{BOLD}{wrap(action)}{OFF}")
        if narration:
            out.append(wrap(narration))
        out.append("")
    return "\n".join(out).rstrip()


def render_status(campaign, turn):
    lines = [f"{BOLD}tesbota{OFF} {DIM}— {turn['turn_id']}{OFF}", ""]
    state = turn["state"]

    if state == "awaiting_clock":
        remaining = parse(turn["wake_at"]) - now()
        lines.append(f"  the adventurer is on the road to {turn.get('destination')}")
        lines.append(f"  wakes in {duration(remaining)}"
                     + (", and the road does not get them there" if turn.get("leagues_left") else ""))
    elif state == "awaiting_human":
        lines.append(f"  {WARN}the lore master is waiting on you{OFF} — run: tesbota lore")
        lines.append("")
        for line in (turn.get("gap") or "").strip().splitlines():
            lines.append(f"  {line}")
    elif state == "done":
        lines.append("  the adventurer is between turns")
    else:
        lines.append(f"  mid-turn: {state}")

    turns = all_turns()
    seen = campaign.get("last_seen")
    fresh = [t for t in turns if not seen or t["turn_id"] > seen]
    fresh = [t for t in fresh if t.get("action") or (t.get("draft") or {}).get("narration")]
    if fresh:
        lines += ["", f"  {len(fresh)} new turn(s) since you last looked — run: tesbota log"]

    narration = campaign.get("last_narration")
    if narration and state != "awaiting_human":
        lines += ["", f"{DIM}  last seen:{OFF}", wrap(narration)]

    return "\n".join(lines)
