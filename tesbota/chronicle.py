from . import canon, db
from .config import CHRONICLE, CHRONICLE_NAME, NARRATOR, WORLD_START


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


def compose(turn):
    """One paragraph out of everything the game master said this turn, in order.
    The explorer's own utterances are what prompted them, not the record."""
    said = [
        " ".join((p.get("text") or "").split())
        for p in turn.get("phases") or []
        if p.get("who") == "gm" and (p.get("text") or "").strip()
    ]
    if not said:
        narration = " ".join(((turn.get("draft") or {}).get("narration") or "").split())
        said = [narration] if narration else []
    return " ".join(said)


def write(turn):
    ensure_book(turn.get("turn_id"))
    text = compose(turn)
    if not text:
        return []
    ord_ = next_ord()
    with db.writing() as con:
        con.execute(
            "INSERT INTO passage (book_id, ord, text) VALUES (?,?,?)",
            (CHRONICLE, ord_, text),
        )
    return since(ord_)


def narrated(turn):
    return bool(turn.get("chronicle"))


def played(turn):
    if turn.get("state") == "awaiting_human":
        return False
    if turn.get("phases"):
        return any(p.get("who") == "gm" and (p.get("text") or "").strip() for p in turn["phases"])
    return bool((turn.get("draft") or {}).get("narration"))
