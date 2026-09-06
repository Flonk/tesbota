import re

from . import canon, db
from .config import STUB

WS = re.compile(r"\s+")


def normalise(text):
    return WS.sub(" ", text).strip()


def verify(quotes):
    failures = []
    for quote in quotes or []:
        src = (quote.get("src") or "").strip()
        text = quote.get("text") or ""
        if not src or not text.strip():
            failures.append({"src": src, "reason": "quote is missing src or text"})
            continue

        found = db.targets(src)
        if not found or found[0][0] != "books":
            failures.append({"src": src, "reason": "src must be a book deeplink, like bota://books/some-book#p3"})
            continue

        _, book_id, fragment = found[0]
        if not canon.find_entity(book_id):
            failures.append({"src": src, "reason": "no such book"})
            continue
        if not fragment.startswith("p"):
            failures.append({"src": src, "reason": "src must name the passage you quoted, like #p3"})
            continue
        if STUB in text:
            failures.append({
                "src": src,
                "reason": f"the quoted passage is marked {STUB} — it is not written yet and cannot be read out",
            })
            continue

        row = canon.passage(book_id, int(fragment[1:]))
        if row is None:
            failures.append({"src": src, "reason": f"{book_id} has no passage {fragment}"})
            continue
        if STUB in row["text"]:
            failures.append({
                "src": src,
                "reason": f"the quoted passage is marked {STUB} — it is not written yet and cannot be read out",
            })
            continue
        if normalise(text) in normalise(row["text"]):
            continue

        elsewhere = [
            p["ord"] for p in canon.passages(book_id) if normalise(text) in normalise(p["text"])
        ]
        if elsewhere:
            failures.append({
                "src": src,
                "reason": f"that text is passage #p{elsewhere[0]} of this book, not {fragment} — cite it correctly",
            })
        else:
            failures.append({"src": src, "reason": "quoted text is not verbatim in that passage"})
    return failures
