import re

import yaml

from .config import CANON, FORBIDDEN_AUTHORS, GODHEAD, KINDS, STUB

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
        front += ["within:", "contains: []", "exits: []"]
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
    try:
        data = yaml.safe_load(block)
    except yaml.YAMLError:
        return {}
    return data if isinstance(data, dict) else {}


def exits(path):
    out = []
    for entry in frontmatter(path).get("exits") or []:
        if isinstance(entry, dict) and entry.get("to"):
            out.append({
                "to": slug(str(entry["to"]).strip("[]")),
                "bearing": str(entry.get("bearing") or "").strip(),
                "distance": str(entry.get("distance") or "").strip(),
            })
    return out


def graph():
    nodes, edges, links = {}, [], []
    directory = CANON / "places"
    if not directory.exists():
        return nodes, edges, links
    for path in sorted(directory.glob("*.md")):
        fm = frontmatter(path)
        nodes[path.stem] = {
            "name": str(fm.get("name") or path.stem),
            "stub": STUB in path.read_text(encoding="utf-8"),
        }
        within = str(fm.get("within") or "").strip().strip("[]")
        if within and within != STUB:
            links.append((slug(within), path.stem))
        for exit in exits(path):
            edges.append((path.stem, exit["to"], exit["bearing"], exit["distance"]))
    return nodes, edges, links


def mermaid():
    nodes, edges, links = graph()
    if not nodes:
        return "graph LR\n  empty[the world has no places yet]"

    children = {}
    parent_of = {}
    for parent, child in links:
        if parent in nodes and child in nodes and parent != child:
            children.setdefault(parent, []).append(child)
            parent_of[child] = parent

    out = ["graph LR"]

    def emit(ident, depth, seen):
        pad = "  " * (depth + 1)
        label = nodes[ident]["name"]
        kids = sorted(children.get(ident, []))
        if not kids:
            out.append(f"{pad}{ident}[{label}]")
            return
        out.append(f"{pad}subgraph {ident}[{label}]")
        for kid in kids:
            if kid in seen:
                continue
            emit(kid, depth + 1, seen | {kid})
        out.append(f"{pad}end")

    roots = [i for i in sorted(nodes) if i not in parent_of]
    for root in roots:
        emit(root, 0, {root})

    for src, dst, bearing, distance in edges:
        if dst not in nodes:
            continue
        label = " ".join(x for x in (bearing, distance) if x)
        arrow = f"-- {label} -->" if label else "-->"
        out.append(f"  {src} {arrow} {dst}")

    stubs = [i for i, m in sorted(nodes.items()) if m["stub"] and not children.get(i)]
    if stubs:
        out.append("  classDef unwritten stroke-dasharray: 4 3")
        out.append(f"  class {','.join(stubs)} unwritten")
    return "\n".join(out)


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


def stubs():
    out = []
    for kind in KINDS:
        directory = CANON / kind
        if not directory.exists():
            continue
        for path in sorted(directory.glob("*.md")):
            for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                if STUB in line:
                    out.append((str(path.relative_to(CANON.parent)), n, line.strip()))
    return out


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


def slug(text):
    return "-".join(text.split()).strip("-").lower()


def dangling_links():
    entities = all_entities()
    known = {slug(name) for name in entities}
    gaps = {}
    for entity_id, path in entities.items():
        for target in LINK.findall(path.read_text(encoding="utf-8")):
            target = slug(target)
            if target and target not in known:
                sources = gaps.setdefault(target, [])
                if entity_id not in sources:
                    sources.append(entity_id)
    return gaps
