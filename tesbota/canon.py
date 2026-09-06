from . import db
from .config import FORBIDDEN_AUTHORS, GODHEAD, KINDS, STUB

WITNESSED = "witnessed"
ATTESTED = "attested"
MAP = "map"


def slug(text):
    return "-".join(str(text or "").split()).strip("-").lower()


def find_entity(entity_id):
    return db.row("SELECT * FROM entity WHERE id = ?", (slug(entity_id),))


def kind_of(entity_id):
    return db.value("SELECT kind FROM entity WHERE id = ?", (slug(entity_id),))


def ensure_entity(kind, entity_id, name=None, turn_id=None, author=None):
    entity_id = slug(entity_id)
    if kind not in KINDS:
        kind = "places"
    with db.writing() as con:
        con.execute(
            "INSERT OR IGNORE INTO entity (id, kind, name, introduced) VALUES (?,?,?,?)",
            (entity_id, kind, name or entity_id.replace("-", " ").title(), turn_id),
        )
        if kind == "books":
            author = author or "unknown"
            con.execute(
                "INSERT OR IGNORE INTO book (id, author, author_id) VALUES (?,?,?)",
                (entity_id, author, db.value("SELECT id FROM entity WHERE id = ? AND kind = 'people'", (slug(author),))),
            )
    return entity_id


def append_section(entity_id, turn_id, text, kind="places", section=WITNESSED):
    entity_id = slug(entity_id)
    if not find_entity(entity_id):
        ensure_entity(kind, entity_id, turn_id=turn_id)
    with db.writing() as con:
        con.execute(
            "INSERT OR IGNORE INTO claim (entity_id, section, turn_id, text) VALUES (?,?,?,?)",
            (entity_id, section, turn_id, text.strip()),
        )
    return entity_id


def append_witnessed(entity_id, turn_id, text, kind="places"):
    return append_section(entity_id, turn_id, text, kind=kind, section=WITNESSED)


def append_attested(entity_id, turn_id, text, kind="places"):
    return append_section(entity_id, turn_id, text, kind=kind, section=ATTESTED)


def claims(entity_id, section=None):
    if section:
        return db.rows(
            "SELECT * FROM claim WHERE entity_id = ? AND section = ? ORDER BY id", (slug(entity_id), section)
        )
    return db.rows("SELECT * FROM claim WHERE entity_id = ? ORDER BY section, id", (slug(entity_id),))


def passages(book_id):
    return db.rows("SELECT * FROM passage WHERE book_id = ? ORDER BY ord", (slug(book_id),))


def passage(book_id, ord):
    return db.row("SELECT * FROM passage WHERE book_id = ? AND ord = ?", (slug(book_id), ord))


def exits(place_id):
    return [
        {"to": r["dst"], "bearing": r["bearing"] or "", "distance": r["distance"] or ""}
        for r in db.rows("SELECT * FROM edge WHERE src = ? AND rel = 'exits' ORDER BY dst", (slug(place_id),))
    ]


def within(place_id):
    return db.value("SELECT dst FROM edge WHERE src = ? AND rel = 'within'", (slug(place_id),))


def contains(place_id):
    return [r["src"] for r in db.rows("SELECT src FROM edge WHERE rel = 'within' AND dst = ? ORDER BY src", (slug(place_id),))]


def ancestry(place_id):
    rows = db.rows(
        """
        WITH RECURSIVE up(id, depth) AS (
          SELECT ?, 0
          UNION
          SELECT e.dst, up.depth + 1 FROM edge e JOIN up ON e.src = up.id AND e.rel = 'within' WHERE up.depth < 24
        )
        SELECT up.id, coalesce(entity.name, replace(up.id, '-', ' ')) AS name, up.depth
          FROM up LEFT JOIN entity ON entity.id = up.id
         ORDER BY up.depth DESC
        """,
        (slug(place_id),),
    )
    return [{"id": r["id"], "name": r["name"]} for r in rows if r["id"]]


def library():
    shelf = []
    for r in db.rows(
        """
        SELECT e.id, e.name, b.author, b.author_id, b.written, b.rarity
          FROM book b JOIN entity e ON e.id = b.id
         ORDER BY lower(e.name)
        """
    ):
        shelf.append({
            "id": r["id"],
            "name": r["name"],
            "author": r["author"] or "",
            "author_id": r["author_id"],
            "written": r["written"] or "",
            "rarity": (r["rarity"] or "").lower(),
            "godhead": (r["author"] or "").strip().lower() == GODHEAD,
        })
    return shelf


def godhead_books():
    return [r["id"] for r in db.rows("SELECT id FROM book WHERE lower(trim(author)) = ?", (GODHEAD,))]


def is_godhead(book_id):
    return (db.value("SELECT author FROM book WHERE id = ?", (slug(book_id),)) or "").strip().lower() == GODHEAD


def illegal_books():
    return [
        r["id"] for r in db.rows("SELECT id, lower(trim(author)) a FROM book")
        if r["a"] in FORBIDDEN_AUTHORS
    ]


def orphan_places():
    return [
        r["id"] for r in db.rows(
            """
            SELECT e.id FROM entity e
             WHERE e.kind = 'places'
               AND NOT EXISTS (SELECT 1 FROM edge WHERE src = e.id AND rel = 'within')
             ORDER BY e.id
            """
        )
    ]


def all_entities():
    return {r["id"]: r["kind"] for r in db.rows("SELECT id, kind FROM entity ORDER BY kind, id")}


def stubs():
    out = []
    for r in db.rows("SELECT ref, body FROM writing WHERE body LIKE ? ORDER BY ref", (f"%{STUB}%",)):
        out.append((r["ref"], " ".join(r["body"].split())))
    for r in db.rows("SELECT id, kind FROM unwritten ORDER BY kind, id"):
        out.append((db.link(r["kind"], r["id"]), "nothing written yet"))
    for r in db.rows("SELECT id FROM book WHERE written IS NULL OR trim(written) = '' ORDER BY id"):
        out.append((db.link("books", r["id"]), "no date of writing"))
    return out


def dangling_links():
    gaps = {}
    known = set(all_entities())
    for r in db.rows("SELECT ref, entity, body FROM writing WHERE body LIKE '%bota://%'"):
        for kind, ident, _ in db.targets(r["body"]):
            if ident in known:
                continue
            sources = gaps.setdefault(f"{kind}/{ident}", [])
            if r["entity"] not in sources:
                sources.append(r["entity"])
    return gaps


def mentions(entity_id):
    entity_id = slug(entity_id)
    return db.rows(
        """
        SELECT ref, entity, section FROM writing WHERE body LIKE ?
        UNION ALL
        SELECT 'bota://books/' || id, id, 'author' FROM book WHERE author_id = ?
        """,
        (f"%/{entity_id}%", entity_id),
    )


def graph():
    nodes, edges, links = {}, [], []
    unwritten = {r["id"] for r in db.rows("SELECT id FROM unwritten")}
    for r in db.rows("SELECT id, name FROM entity WHERE kind = 'places' ORDER BY id"):
        nodes[r["id"]] = {"name": r["name"], "stub": r["id"] in unwritten}
    for r in db.rows("SELECT src, rel, dst, bearing, distance FROM edge ORDER BY src, rel, dst"):
        if r["rel"] == "within":
            links.append((r["dst"], r["src"]))
        else:
            edges.append((r["src"], r["dst"], r["bearing"] or "", r["distance"] or ""))
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

    stubs_ = [i for i, m in sorted(nodes.items()) if m["stub"] and not children.get(i)]
    if stubs_:
        out.append("  classDef unwritten stroke-dasharray: 4 3")
        out.append(f"  class {','.join(stubs_)} unwritten")
    return "\n".join(out)
