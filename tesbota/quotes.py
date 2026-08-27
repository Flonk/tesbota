import re

from .config import ROOT

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
        path = (ROOT / src).resolve()
        try:
            path.relative_to(ROOT.resolve())
        except ValueError:
            failures.append({"src": src, "reason": "src escapes the repository"})
            continue
        if not path.exists():
            failures.append({"src": src, "reason": "no such file"})
            continue
        body = path.read_text(encoding="utf-8")
        if normalise(text) not in normalise(body):
            failures.append({"src": src, "reason": "quoted text is not verbatim in the source"})
    return failures
