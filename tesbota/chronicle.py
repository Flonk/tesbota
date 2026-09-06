import re

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


ARTICLE = re.compile(r"^(?:the|a|an)\s+", re.I)
ANCHORED = re.compile(r"\[[^\]]*\]\(bota://[^)]*\)")
QUOTED = re.compile("\"[^\"]*\"|\u201c[^\u201d]*\u201d")
SHORTEST_NAME = 3


def candidates():
    """Every string that names something, longest first, so a mill inside a
    village is linked as the mill and not as the village."""
    forms = {}
    for r in db.rows("SELECT id, kind, name FROM entity"):
        for form in (r["name"], ARTICLE.sub("", r["name"] or ""), r["id"].replace("-", " ")):
            form = " ".join((form or "").split())
            if len(form) >= SHORTEST_NAME:
                forms.setdefault(form.lower(), (form, r["kind"], r["id"]))
    return sorted(forms.values(), key=lambda c: -len(c[0]))


def name_pattern(form):
    return re.compile(r"(?<!\w)" + r"\s+".join(re.escape(w) for w in form.split()) + r"(?!\w)", re.I)


def link_names(text):
    """Turn the names of things the world already knows into addresses, once
    each, leaving quotations and existing links exactly as they were."""
    if not text:
        return text
    kept = [m.span() for m in ANCHORED.finditer(text)]
    kept += [m.span() for m in QUOTED.finditer(text)]
    kept += [m.span() for m in db.LINK.finditer(text)]
    linked = set(db.mentioned(text))
    edits = []
    for form, kind, ident in candidates():
        if ident in linked:
            continue
        for m in name_pattern(form).finditer(text):
            if any(m.start() < end and start < m.end() for start, end in kept):
                continue
            edits.append((m.start(), m.end(), f"[{m.group(0)}]({db.link(kind, ident)})"))
            kept.append(m.span())
            linked.add(ident)
            break
    for start, end, address in sorted(edits, reverse=True):
        text = text[:start] + address + text[end:]
    return text


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
            (CHRONICLE, ord_, link_names(text)),
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


if __name__ == "__main__":
    plain = "They left Alheim by the Alheim Mill and drank at the Alheim Inn."
    once = link_names(plain)
    print(once)
    assert "[Alheim Mill](bota://places/alheim-mill)" in once
    assert "[the Alheim Inn](bota://places/the-alheim-inn)" in once
    assert "[Alheim](bota://places/alheim)" in once
    assert link_names(once) == once
    held = 'She read out "the road runs past the Alheim Mill" and said nothing else.'
    assert link_names(held) == held
