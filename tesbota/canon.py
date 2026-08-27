import re

from .config import CANON, KINDS

LINK = re.compile(r"\[\[([^\]|#]+)")
WITNESSED = "## Witnessed"


def entity_path(kind, entity_id):
    return CANON / kind / f"{entity_id}.md"


def find_entity(entity_id):
    for kind in KINDS:
        path = entity_path(kind, entity_id)
        if path.exists():
            return path
    return None


def ensure_entity(kind, entity_id, name=None, turn_id=None):
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
    if turn_id:
        front.append(f"introduced: {turn_id}")
    front.append("---")
    body = "\n".join(front) + "\n\n## Attested\n\n" + WITNESSED + "\n"
    path.write_text(body, encoding="utf-8")
    return path


def append_witnessed(entity_id, turn_id, text, kind="places"):
    path = find_entity(entity_id) or ensure_entity(kind, entity_id, turn_id=turn_id)
    body = path.read_text(encoding="utf-8").rstrip("\n")
    line = f"- {turn_id} — {text.strip()}"
    if text.strip() in body:
        return path
    if WITNESSED in body:
        head, _, tail = body.partition(WITNESSED)
        body = head + WITNESSED + tail.rstrip("\n") + "\n" + line
    else:
        body = body + "\n\n" + WITNESSED + "\n" + line
    path.write_text(body + "\n", encoding="utf-8")
    return path


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
