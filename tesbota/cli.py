import argparse
import json
import sys

from . import actions, canon, driver, prompts, view
from .config import MODELS, WRITE_TOOLS
from .sdk import ask
from .state import all_turns, load_campaign, load_turn, now, parse, save_campaign


def cmd_init(args):
    from .state import ensure_layout

    ensure_layout()
    campaign = load_campaign()
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
            campaign["sessions"]["lore3_sitting"] = None
            save_campaign(campaign)
            driver.resolve_gap(campaign, turn)
            print("silence filled. run: tesbota step")
            return
        if not message:
            message = "Go on."


def cmd_snapshot(args):
    print(json.dumps(actions.snapshot(), ensure_ascii=False))


def cmd_say(args):
    print(json.dumps(actions.say(args.text), ensure_ascii=False))


def cmd_resolve(args):
    print(json.dumps(actions.resolve(), ensure_ascii=False))


def cmd_gaps(args):
    orphans = canon.orphan_places()
    gaps = canon.dangling_links()
    illegal = canon.illegal_books()
    for book in illegal:
        print(f"{book}  (authored by the adventurer — not a valid author)")
    if not orphans and not gaps and not illegal:
        print("no open edges — every place is placed and no link dangles")
        return
    for place in orphans:
        print(f"{place}  (no parent place)")
    for target, sources in sorted(gaps.items()):
        print(f"{target}  <- {', '.join(sources)}")


def main(argv=None):
    parser = argparse.ArgumentParser(prog="tesbota")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init").set_defaults(func=cmd_init)

    step = sub.add_parser("step")
    step.add_argument("--limit", type=int, default=1)
    step.add_argument("--json", action="store_true")
    step.set_defaults(func=cmd_step)

    sub.add_parser("snapshot").set_defaults(func=cmd_snapshot)

    say = sub.add_parser("say")
    say.add_argument("text")
    say.set_defaults(func=cmd_say)

    sub.add_parser("resolve").set_defaults(func=cmd_resolve)

    sub.add_parser("status").set_defaults(func=cmd_status)

    log = sub.add_parser("log")
    log.add_argument("-n", type=int, default=10)
    log.add_argument("--new", action="store_true")
    log.set_defaults(func=cmd_log)
    sub.add_parser("lore").set_defaults(func=cmd_lore)
    sub.add_parser("gaps").set_defaults(func=cmd_gaps)

    args = parser.parse_args(argv)
    return args.func(args) or 0


if __name__ == "__main__":
    sys.exit(main())
