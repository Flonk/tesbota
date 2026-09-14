import argparse
import json
import sys
from pathlib import Path

from . import actions, canon, chronicle, db, driver, mapping, prompts, sheet, view, worldclock
from .gate import sqlite_gate
from .config import EXPLORER, MODELS, STARTING_INVENTORY, WRITE_TOOLS
from .sdk import ask
from .config import (
    FIRST_NAMES,
    ITEM_TYPES,
    NARRATOR,
    RARITY,
    STARTING_INVENTORY,
    STUB,
    SURNAME,
    TRAITS,
)
from .state import (
    all_turns,
    explorer_name,
    load_campaign,
    load_turn,
    now,
    parse,
    save_campaign,
    save_turn,
)


def cmd_init(args):
    from .state import ensure_layout

    ensure_layout()
    db.setup()
    chronicle.ensure_book()
    campaign = load_campaign()
    if not canon.holdings(EXPLORER):
        for item in STARTING_INVENTORY:
            canon.give(EXPLORER, item["name"], item["qty"], note=item["note"], worn=item["worn"])
    if campaign.get("current_turn"):
        print(f"already initialised — turn {campaign['current_turn']}")
        return
    turn = driver.open_world(campaign)
    print(f"tesbota initialised. {turn['turn_id']}:")
    print()
    print(load_campaign()["last_narration"])


def cmd_step(args):
    if getattr(args, "json", False):
        print(json.dumps(actions.step(), ensure_ascii=False))
        return
    state, turn = driver.run(limit=args.limit)
    if state == "awaiting_human":
        print(f"[{turn['turn_id']}] the world is silent. run: tesbota lore")
        print()
        print(turn.get("gap", "").strip())
    elif state == "awaiting_clock":
        remaining = parse(turn["wake_at"]) - now()
        minutes = max(0, int(remaining.total_seconds() // 60))
        print(f"[{turn['turn_id']}] travelling to {turn.get('destination')} — {minutes} min to go")
    else:
        print(f"[{turn['turn_id']}] {state}")
        narration = load_campaign().get("last_narration")
        if narration:
            print()
            print(narration)


def cmd_status(args):
    campaign = load_campaign()
    if not campaign.get("current_turn"):
        print("no campaign yet. run: tesbota init")
        return
    print(view.render_status(campaign, load_turn(campaign["current_turn"])))


def cmd_log(args):
    campaign = load_campaign()
    turns = all_turns()
    seen = campaign.get("last_seen")
    if args.new:
        turns = [t for t in turns if not seen or t["turn_id"] > seen]
    elif args.n:
        turns = turns[-args.n:]
    if not turns:
        print("nothing has happened yet")
        return
    print(view.render_log(turns, since=seen))
    if turns:
        campaign["last_seen"] = turns[-1]["turn_id"]
        save_campaign(campaign)


def cmd_lore(args):
    campaign = load_campaign()
    turn = load_turn(campaign["current_turn"])
    if turn["state"] != "awaiting_human":
        print(f"nothing is pending — turn {turn['turn_id']} is {turn['state']}")
        return

    session = campaign["sessions"].get("lore3_sitting")
    message = prompts.lore3_turn(turn["gap"]) if not session else "Continue."

    print("lore master. ctrl-d to end the sitting, /resolve when the silence is filled.")
    while True:
        reply, session = ask(
            message,
            system=prompts.LORE3_SYSTEM,
            tools=WRITE_TOOLS,
            permission=sqlite_gate(readonly=False),
            session=session,
            model=MODELS["lore3"],
        )
        campaign["sessions"]["lore3_sitting"] = session
        save_campaign(campaign)
        print()
        print(reply)
        print()
        try:
            message = input("> ").strip()
        except EOFError:
            print()
            break
        if message in ("/resolve", "/done"):
            print("silence filled — carrying on…")
            print(json.dumps(actions.resolve(), ensure_ascii=False))
            return
        if not message:
            message = "Go on."


def cmd_say(args):
    print(json.dumps(actions.say(args.text), ensure_ascii=False))


def cmd_resolve(args):
    print(json.dumps(actions.resolve(), ensure_ascii=False))


def cmd_data(args):
    taken = canon.given_names()
    payload = {
        "names": {
            "surname": SURNAME,
            "current": explorer_name(),
            "pool": [{"name": n, "taken": n.lower() in taken} for n in FIRST_NAMES],
        },
        "personality": [{"trait": t, "rarity": r} for t, r in TRAITS],
        "rarity": [{"rarity": name, "weight": weight} for name, weight in RARITY],
        "kit": [dict(entry, id=canon.slug(entry["name"]), slot=entry.get("slot"))
                for entry in STARTING_INVENTORY],
        "items": [{"type": t, "stats": stats, "icon": icon, "slots": list(slots)}
                  for t, stats, icon, slots in ITEM_TYPES],
        "prompts": prompts.catalogue(),
    }
    if getattr(args, "json", False):
        print(json.dumps(payload, ensure_ascii=False))
        return
    free = sum(1 for n in payload["names"]["pool"] if not n["taken"])
    print(f"names: {free} of {len(payload['names']['pool'])} still free, "
          f"{payload['names']['current']} walking")
    print(f"personality: {len(payload['personality'])} traits")
    for entry in payload["prompts"]:
        print(f"  {entry['label']:14} {len(entry['text']):6} chars")


def cmd_talk(args):
    result = actions.talk(args.text)
    if getattr(args, "json", False):
        print(json.dumps(result, ensure_ascii=False))
        return
    print(result.get("reply") or result.get("error"))


def cmd_traits(args):
    """Three traits for somebody who has none. Rolled once and kept."""
    if args.who:
        picked = canon.traits(args.who, roll=True)
        print(", ".join(picked))
        return
    print(", ".join(canon.roll_traits()))


def cmd_prompts(args):
    """Carry the prompts out to somewhere they can be edited, and back again."""
    import shutil
    from .prompts import PROMPTS

    there = Path(args.dir).expanduser()
    if args.back:
        moved = []
        for path in sorted(there.glob("*.md")):
            kept = PROMPTS / path.name
            if kept.exists() and kept.read_text() != path.read_text():
                shutil.copyfile(path, kept)
                moved.append(path.name)
        print("\n".join(f"  {n}" for n in moved) or "  nothing changed")
        return
    there.mkdir(parents=True, exist_ok=True)
    for path in sorted(PROMPTS.glob("*.md")):
        shutil.copyfile(path, there / path.name)
    print(f"{len(list(PROMPTS.glob('*.md')))} prompts written to {there}")


def cmd_play(args):
    """Turn the world over on its own until it is paused, blocked or stopped."""
    import time

    while True:
        campaign = load_campaign()
        if campaign.get("paused"):
            time.sleep(args.every)
            continue
        state, turn = driver.run(limit=1)
        print(f"[{turn['turn_id']}] {state}", flush=True)
        if state == "awaiting_human":
            time.sleep(args.every)
        elif state == "awaiting_clock":
            time.sleep(min(args.every, 30))
        else:
            time.sleep(args.every)


def cmd_pause(args):
    on = load_campaign().get("paused") if args.state is None else args.state == "on"
    result = actions.pause(on) if args.state is not None else {"ok": True, "paused": bool(on)}
    if getattr(args, "json", False):
        print(json.dumps(result, ensure_ascii=False))
        return
    print("the world is paused" if result["paused"] else "the world is running")


def cmd_speed(args):
    if args.factor is None:
        speed = (load_campaign().get("clock") or {}).get("speed_factor")
        result = {"ok": True, "speed": speed}
    else:
        result = actions.set_speed(args.factor)
    if getattr(args, "json", False):
        print(json.dumps(result, ensure_ascii=False))
        return
    print(f"{result['speed']} minutes of world time to the minute")


def cmd_kill(args):
    result = actions.kill(args.cause)
    if getattr(args, "json", False):
        print(json.dumps(result, ensure_ascii=False))
        return
    print(f"recorded: {result['cause']}. the next step ends the life and begins another.")


def cmd_stats(args):
    print(sheet.render_stats())


def cmd_inventory(args):
    load_campaign()
    print(sheet.render_inventory())


def cmd_time(args):
    campaign = load_campaign()
    t = campaign.get("time")
    print(f"{worldclock.long_stamp(t)}  ({worldclock.part_of_day(t)})")


def cmd_quests(args):
    print(sheet.render_quest_log())


def cmd_library(args):
    shelf = canon.library()
    if not shelf:
        print("no books")
        return
    width = max(len(b["name"]) for b in shelf)
    for b in shelf:
        when = b["written"] or STUB
        mark = " (godhead)" if b["godhead"] else ""
        print(f"  {b['name']:<{width}}  {b['author']}{mark}  [{when}]  {b['rarity'] or '—'}")


def cmd_holdings(args):
    print(sheet.render_holdings(args.entity))


def cmd_note(args):
    print(json.dumps(actions.set_note(args.text), ensure_ascii=False))


def cmd_map(args):
    if args.json:
        print(json.dumps(mapping.layout(), ensure_ascii=False))
        return
    print(canon.mermaid())


def cmd_chronicle(args):
    passages = chronicle.passages()
    if not passages:
        print("the narrator has not written anything yet")
        return
    print(f"{view.BOLD}{chronicle.book_title()}{view.OFF} {view.DIM}— {NARRATOR}{view.OFF}")
    print()
    for entry in passages[-args.n:] if args.n else passages:
        print(f"{view.DIM}{entry['ord']}{view.OFF}")
        print(view.wrap(entry["text"]))
        print()


def main(argv=None):
    parser = argparse.ArgumentParser(prog="tesbota")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init").set_defaults(func=cmd_init)

    step = sub.add_parser("step")
    step.add_argument("--limit", type=int, default=1)
    step.add_argument("--json", action="store_true")
    step.set_defaults(func=cmd_step)


    say = sub.add_parser("say")
    say.add_argument("text")
    say.set_defaults(func=cmd_say)

    sub.add_parser("resolve").set_defaults(func=cmd_resolve)

    world_data = sub.add_parser("data")
    world_data.add_argument("--json", action="store_true")
    world_data.set_defaults(func=cmd_data)

    talk = sub.add_parser("talk")
    talk.add_argument("text")
    talk.add_argument("--json", action="store_true")
    talk.set_defaults(func=cmd_talk)

    traits = sub.add_parser("traits")
    traits.add_argument("who", nargs="?", default=None)
    traits.set_defaults(func=cmd_traits)

    carry = sub.add_parser("prompts")
    carry.add_argument("dir")
    carry.add_argument("--back", action="store_true", help="copy edits back into the repo")
    carry.set_defaults(func=cmd_prompts)

    play = sub.add_parser("play")
    play.add_argument("--every", type=float, default=5.0)
    play.set_defaults(func=cmd_play)

    hold = sub.add_parser("pause")
    hold.add_argument("state", nargs="?", choices=("on", "off"), default=None)
    hold.add_argument("--json", action="store_true")
    hold.set_defaults(func=cmd_pause)

    speed = sub.add_parser("speed")
    speed.add_argument("factor", nargs="?", type=float, default=None)
    speed.add_argument("--json", action="store_true")
    speed.set_defaults(func=cmd_speed)

    kill = sub.add_parser("kill")
    kill.add_argument("cause", nargs="?", default=None)
    kill.add_argument("--json", action="store_true")
    kill.set_defaults(func=cmd_kill)

    sub.add_parser("stats").set_defaults(func=cmd_stats)
    world_map = sub.add_parser("map")
    world_map.add_argument("--json", action="store_true")
    world_map.set_defaults(func=cmd_map)
    sub.add_parser("quests").set_defaults(func=cmd_quests)
    sub.add_parser("library").set_defaults(func=cmd_library)
    sub.add_parser("time").set_defaults(func=cmd_time)

    note = sub.add_parser("note")
    note.add_argument("text")
    note.set_defaults(func=cmd_note)
    sub.add_parser("inventory").set_defaults(func=cmd_inventory)

    holdings = sub.add_parser("holdings")
    holdings.add_argument("entity", nargs="?")
    holdings.set_defaults(func=cmd_holdings)

    book = sub.add_parser("chronicle")
    book.add_argument("-n", type=int, default=0)
    book.set_defaults(func=cmd_chronicle)


    sub.add_parser("status").set_defaults(func=cmd_status)

    log = sub.add_parser("log")
    log.add_argument("-n", type=int, default=10)
    log.add_argument("--new", action="store_true")
    log.set_defaults(func=cmd_log)
    sub.add_parser("lore").set_defaults(func=cmd_lore)

    args = parser.parse_args(argv)
    return args.func(args) or 0


if __name__ == "__main__":
    sys.exit(main())
