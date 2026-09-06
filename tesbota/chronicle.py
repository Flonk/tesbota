from . import canon, db, prompts
from .config import (
    CHRONICLE,
    CHRONICLE_NAME,
    MODELS,
    NARRATOR,
    NARRATOR_TABLES,
    WORLD_START,
    WRITE_TOOLS,
)
from .gate import sqlite_gate
from .sdk import ask


def ensure_book(turn_id=None):
    era, year = WORLD_START["era"], WORLD_START["year"]
    with db.writing() as con:
        con.execute(
            "INSERT OR IGNORE INTO entity (id, kind, name, introduced) VALUES (?,?,?,?)",
            (CHRONICLE, "books", CHRONICLE_NAME, turn_id),
        )
        con.execute(
            "INSERT OR IGNORE INTO book (id, author, author_id, written, rarity) VALUES (?,?,?,?,?)",
            (CHRONICLE, NARRATOR, None, f"{era}E{year}", "unique"),
        )
    return CHRONICLE


def passages():
    return [dict(ord=r["ord"], text=r["text"]) for r in canon.passages(CHRONICLE)]


def next_ord():
    return (db.value("SELECT max(ord) FROM passage WHERE book_id = ?", (CHRONICLE,)) or 0) + 1


def tail(count=3):
    rows = db.rows(
        "SELECT ord, text FROM passage WHERE book_id = ? ORDER BY ord DESC LIMIT ?",
        (CHRONICLE, count),
    )
    return [dict(ord=r["ord"], text=r["text"]) for r in reversed(rows)]


def since(start):
    return [
        dict(ord=r["ord"], text=r["text"])
        for r in db.rows(
            "SELECT ord, text FROM passage WHERE book_id = ? AND ord >= ? ORDER BY ord",
            (CHRONICLE, start),
        )
    ]


def write(turn, now=None, where=None):
    """Hand the narrator one finished turn and let it set down what happened."""
    ensure_book(turn.get("turn_id"))
    start = next_ord()
    ask(
        prompts.narrator_turn(turn, now=now, where=where, tail=tail(), start=start),
        system=prompts.NARRATOR_SYSTEM,
        tools=WRITE_TOOLS,
        permission=sqlite_gate(readonly=False, tables=NARRATOR_TABLES),
        session=None,
        model=MODELS["narrator"],
    )
    return since(start)


def narrated(turn):
    return bool(turn.get("chronicle"))


def backfill(turns, echo=print):
    """Write the life so far, one played turn at a time, for a world that ran
    before the narrator existed."""
    ensure_book()
    written = []
    for turn in turns:
        if narrated(turn) or not played(turn):
            continue
        added = write(
            turn,
            now=turn.get("at"),
            where=turn.get("location_path"),
        )
        turn["chronicle"] = added
        written.append((turn["turn_id"], added))
        echo(f"  {turn['turn_id']}  {len(added)} passage(s)")
    return written


def played(turn):
    if turn.get("state") == "awaiting_human":
        return False
    if turn.get("phases"):
        return any(p.get("who") == "gm" and (p.get("text") or "").strip() for p in turn["phases"])
    return bool((turn.get("draft") or {}).get("narration"))
