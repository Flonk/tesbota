import argparse
import sys

from . import canon, driver, prompts
from .config import WRITE_TOOLS
from .sdk import ask
from .state import load_campaign, load_turn, now, parse, save_campaign


def cmd_init(args):
    campaign = load_campaign()
    driver.run(limit=0)
    save_campaign(campaign)
    print(f"tesbota initialised. turn {campaign.get('current_turn') or 't0001'} awaits.")


def cmd_step(args):
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
    turn = load_turn(campaign["current_turn"])
    print(f"turn      {turn['turn_id']}")
    print(f"state     {turn['state']}")
    if turn.get("wake_at"):
        remaining = parse(turn["wake_at"]) - now()
        print(f"wakes in  {max(0, int(remaining.total_seconds() // 60))} min")
    pending = [e for e in turn.get("schedule", []) if not e["fired"]]
    if pending:
        print(f"events    {len(pending)} unfired")
    if turn.get("gap"):
        print()
        print(turn["gap"].strip())


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
            message, system=prompts.LORE3_SYSTEM, tools=WRITE_TOOLS, session=session
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


def cmd_gaps(args):
    gaps = canon.dangling_links()
    if not gaps:
        print("no dangling links — the world has no frontier right now")
        return
    for target, sources in sorted(gaps.items()):
        print(f"{target}  <- {', '.join(sources)}")


def main(argv=None):
    parser = argparse.ArgumentParser(prog="tesbota")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init").set_defaults(func=cmd_init)

    step = sub.add_parser("step")
    step.add_argument("--limit", type=int, default=1)
    step.set_defaults(func=cmd_step)

    sub.add_parser("status").set_defaults(func=cmd_status)
    sub.add_parser("lore").set_defaults(func=cmd_lore)
    sub.add_parser("gaps").set_defaults(func=cmd_gaps)

    args = parser.parse_args(argv)
    return args.func(args) or 0


if __name__ == "__main__":
    sys.exit(main())
