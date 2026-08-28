import re

from .config import CANON, FORBIDDEN_AUTHORS, GODHEAD, KINDS

LINK = re.compile(r"\[\[([^\]|#]+)")
WITNESSED = "## Witnessed"
ATTESTED = "## Attested"


def entity_path(kind, entity_id):
    return CANON / kind / f"{entity_id}.md"


def find_entity(entity_id):
    for kind in KINDS:
        path = entity_path(kind, entity_id)
        if path.exists():
            return path
    return None


SECTIONS = {
    "places": ["## Map", "## Attested", "## Witnessed"],
    "books": ["## Text"],
    "people": ["## Attested", "## Witnessed"],
    "items": ["## Attested", "## Witnessed"],
}


def ensure_entity(kind, entity_id, name=None, turn_id=None, author=None):
    path = entity_path(kind, entity_id)
    if path.exists():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)

    front = [
        "---",
        f"id: {entity_id}",
        f"kind: {kind[:-1] if kind.endswith('s') else kind}",
        f"name: {name or entity_id.replace('-', ' ').title()}",
    ]
    if kind == "books":
        front.append(f"author: {author or 'unknown'}")
    if kind == "places":
        front += ["within:", "contains: []"]
    if turn_id:
        front.append(f"introduced: {turn_id}")
    front.append("---")

    body = "\n".join(front) + "\n\n" + "\n\n".join(SECTIONS.get(kind, ["## Attested", "## Witnessed"]))
    path.write_text(body + "\n", encoding="utf-8")
    return path


def frontmatter(path):
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---"):
        return {}
    block = text.split("---", 2)[1]
    out = {}
    for line in block.splitlines():
        if ":" in line:
            key, _, value = line.partition(":")
            out[key.strip()] = value.strip()
    return out


def is_godhead(path):
    return frontmatter(path).get("author", "").strip().lower() == GODHEAD


def godhead_books():
    directory = CANON / "books"
    if not directory.exists():
        return []
    return [p for p in sorted(directory.glob("*.md")) if is_godhead(p)]


def append_section(entity_id, turn_id, text, kind="places", section=WITNESSED):
    path = find_entity(entity_id) or ensure_entity(kind, entity_id, turn_id=turn_id)
    body = path.read_text(encoding="utf-8").rstrip("\n")
    line = f"- {turn_id} — {text.strip()}"
    if text.strip() in body:
        return path
    if section in body:
        head, _, tail = body.partition(section)
        rest = tail
        following = None
        for other in (WITNESSED, ATTESTED, "## Map"):
            if other != section and other in rest:
                at = rest.index(other)
                if following is None or at < following:
                    following = at
        if following is None:
            body = head + section + rest.rstrip("\n") + "\n" + line
        else:
            body = head + section + rest[:following].rstrip("\n") + "\n" + line + "\n\n" + rest[following:].rstrip("\n")
    else:
        body = body + "\n\n" + section + "\n" + line
    path.write_text(body + "\n", encoding="utf-8")
    return path


def append_witnessed(entity_id, turn_id, text, kind="places"):
    return append_section(entity_id, turn_id, text, kind=kind, section=WITNESSED)


def append_attested(entity_id, turn_id, text, kind="places"):
    return append_section(entity_id, turn_id, text, kind=kind, section=ATTESTED)


def illegal_books():
    directory = CANON / "books"
    if not directory.exists():
        return []
    out = []
    for path in sorted(directory.glob("*.md")):
        author = frontmatter(path).get("author", "").strip().lower()
        if author in FORBIDDEN_AUTHORS:
            out.append(path.stem)
    return out


def orphan_places():
    directory = CANON / "places"
    if not directory.exists():
        return []
    out = []
    for path in sorted(directory.glob("*.md")):
        within = frontmatter(path).get("within", "").strip()
        if not within:
            out.append(path.stem)
    return out


def all_entities():
    found = {}
    for kind in KINDS:
        directory = CANON / kind
        if not directory.exists():
            continue
        for path in sorted(directory.glob("*.md")):
            found[path.stem] = path
    return found


def dangling_links():
    entities = all_entities()
    gaps = {}
    for entity_id, path in entities.items():
        for target in LINK.findall(path.read_text(encoding="utf-8")):
            target = target.strip()
            if target and target not in entities:
                gaps.setdefault(target, []).append(entity_id)
    return gaps
