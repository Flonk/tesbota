import argparse
import json
import sys

from . import actions, canon, chronicle, db, driver, mapping, prompts, sheet, view, worldclock
from .gate import sqlite_gate
from .config import EXPLORER, MODELS, STARTING_INVENTORY, WRITE_TOOLS
from .sdk import ask
from .config import NARRATOR, STUB
from .state import (
    all_turns,
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


def cmd_reborn(args):
    result = actions.reborn()
    if getattr(args, "json", False):
        print(json.dumps(result, ensure_ascii=False))
        return
    print(f"{result['gone']} is done walking. {result['explorer']} sets out.")
    if result.get("error"):
        print(result["error"])
        return
    print()
    print(load_campaign()["last_narration"])


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


def cmd_notebook(args):
    print(sheet.write_note(args.text) if args.text else sheet.render_notebook())


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

    reborn = sub.add_parser("reborn")
    reborn.add_argument("--json", action="store_true")
    reborn.set_defaults(func=cmd_reborn)

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

    notebook = sub.add_parser("notebook")
    notebook.add_argument("text", nargs="?")
    notebook.set_defaults(func=cmd_notebook)

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
