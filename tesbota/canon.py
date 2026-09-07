import re

from . import db
from .config import CHRONICLE, EXPLORER, FORBIDDEN_AUTHORS, GODHEADS, KINDS, STUB

ATTESTED = "attested"


def open_question(value):
    """Empty and $BOTA both mean the world has not settled this yet."""
    text = (value or "").strip()
    return not text or STUB in text


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
        if kind == "people":
            con.execute("INSERT OR IGNORE INTO person (id) VALUES (?)", (entity_id,))
        if kind == "books":
            author = author or "unknown"
            con.execute(
                "INSERT OR IGNORE INTO book (id, author, author_id) VALUES (?,?,?)",
                (entity_id, author, db.value("SELECT id FROM entity WHERE id = ? AND kind = 'people'", (slug(author),))),
            )
    return entity_id


def append_section(entity_id, turn_id, text, kind="places", section=ATTESTED):
    entity_id = slug(entity_id)
    if not find_entity(entity_id):
        ensure_entity(kind, entity_id, turn_id=turn_id)
    with db.writing() as con:
        con.execute(
            "INSERT OR IGNORE INTO claim (entity_id, section, turn_id, text) VALUES (?,?,?,?)",
            (entity_id, section, turn_id, text.strip()),
        )
    return entity_id


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
            "godhead": (r["author"] or "").strip().lower() in GODHEADS,
            "chronicle": r["id"] == CHRONICLE,
        })
    return shelf


def folk():
    return [
        {
            "id": r["id"],
            "name": r["name"],
            "work": r["work"] or "",
            "lives": r["lives"] or "",
            "lives_name": r["lives_name"] or "",
            "born": r["born"] or "",
            "died": r["died"] or "",
        }
        for r in db.rows(
            """
            SELECT e.id, e.name, p.work, p.lives, p.born, p.died,
                   coalesce(l.name, replace(p.lives, '-', ' ')) AS lives_name
              FROM entity e
              LEFT JOIN person p ON p.id = e.id
              LEFT JOIN entity l ON l.id = p.lives
             WHERE e.kind = 'people'
             ORDER BY lower(e.name)
            """
        )
    ]


def person(entity_id):
    return db.row(
        """
        SELECT p.id, p.work, p.lives, p.born, p.died,
               coalesce(l.name, replace(p.lives, '-', ' ')) AS lives_name
          FROM person p LEFT JOIN entity l ON l.id = p.lives
         WHERE p.id = ?
        """,
        (slug(entity_id),),
    )


def settle(entity_id, **facts):
    entity_id = slug(entity_id)
    ensure_entity("people", entity_id)
    with db.writing() as con:
        con.execute("INSERT OR IGNORE INTO person (id) VALUES (?)", (entity_id,))
        for field in ("work", "born", "died"):
            if facts.get(field) is not None:
                con.execute(f"UPDATE person SET {field} = ? WHERE id = ?", (facts[field], entity_id))
        if facts.get("lives") is not None:
            con.execute(
                "UPDATE person SET lives = ? WHERE id = ?", (slug(facts["lives"]) or None, entity_id)
            )
    return entity_id


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


def link_writing():
    """Run every passage and claim past the linker, so a name in a book is an
    address you can follow back. Books that never linked their own subjects are
    why the record needed restating in the first place."""
    touched = 0
    with db.writing() as con:
        for r in con.execute("SELECT book_id, ord, text FROM passage").fetchall():
            linked = link_names(r["text"])
            if linked != r["text"]:
                con.execute(
                    "UPDATE passage SET text = ? WHERE book_id = ? AND ord = ?",
                    (linked, r["book_id"], r["ord"]),
                )
                touched += 1
        for r in con.execute("SELECT id, text FROM claim").fetchall():
            linked = link_names(r["text"])
            if linked != r["text"]:
                con.execute("UPDATE claim SET text = ? WHERE id = ?", (linked, r["id"]))
                touched += 1
        for r in con.execute("SELECT id, about FROM entity WHERE about IS NOT NULL").fetchall():
            linked = link_names(r["about"])
            if linked != r["about"]:
                con.execute("UPDATE entity SET about = ? WHERE id = ?", (linked, r["id"]))
                touched += 1
    return touched


def references(entity_id):
    entity_id = slug(entity_id)
    return db.value(
        "SELECT count(*) FROM writing WHERE body LIKE ? AND entity <> ?",
        (f"%/{entity_id}%", entity_id),
        default=0,
    )


def godhead_books():
    return [
        r["id"] for r in db.rows("SELECT id, lower(trim(author)) a FROM book ORDER BY id")
        if r["a"] in GODHEADS
    ]


def is_godhead(book_id):
    author = (db.value("SELECT author FROM book WHERE id = ?", (slug(book_id),)) or "").strip().lower()
    return author in GODHEADS


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
    for r in db.rows(
        """
        SELECT e.id, p.work, p.lives, p.born, p.died
          FROM entity e LEFT JOIN person p ON p.id = e.id
         WHERE e.kind = 'people' ORDER BY e.id
        """
    ):
        for field, wanting in (
            ("work", "what they do"),
            ("lives", "where they are"),
            ("born", "when they were born"),
            ("died", "whether they died"),
        ):
            if open_question(r[field]):
                out.append((db.link("people", r["id"]), f"nobody has written {wanting}"))
    return out


def dangling_links():
    gaps = {}
    known = set(all_entities()) | {EXPLORER}
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


def held(holder, name):
    return db.row(
        "SELECT * FROM holding WHERE holder = ? AND lower(name) = lower(?)",
        (holder, str(name or "").strip()),
    )


def holdings(holder):
    return [
        {"name": r["name"], "qty": r["qty"], "note": r["note"] or "", "worn": bool(r["worn"])}
        for r in db.rows("SELECT * FROM holding WHERE holder = ? ORDER BY id", (holder,))
    ]


def holders():
    """Everyone with something to their name. The explorer is one of them and is
    not an entity, because the one moving through this world is never a subject
    of the library."""
    out = []
    for r in db.rows("SELECT DISTINCT holder FROM holding ORDER BY holder"):
        entity = None if r["holder"] == EXPLORER else find_entity(r["holder"])
        out.append({
            "id": r["holder"],
            "name": entity["name"] if entity else r["holder"].replace("-", " "),
            "kind": entity["kind"] if entity else None,
            "explorer": r["holder"] == EXPLORER,
        })
    return out


def give(holder, name, qty=1, note="", worn=False, turn_id=None):
    name = str(name or "").strip()
    if not holder or not name:
        return 0
    qty = int(qty or 1)
    with db.writing() as con:
        row = con.execute(
            "SELECT id, qty FROM holding WHERE holder = ? AND lower(name) = lower(?)", (holder, name)
        ).fetchone()
        if row:
            con.execute("UPDATE holding SET qty = ? WHERE id = ?", (int(row["qty"]) + qty, row["id"]))
        else:
            con.execute(
                "INSERT INTO holding (holder, name, qty, note, worn, turn_id) VALUES (?,?,?,?,?,?)",
                (holder, name, qty, str(note or ""), int(bool(worn)), turn_id),
            )
    return qty


def take(holder, name, qty=1):
    """Give up what is asked for, or everything held if that is less. Taking
    what nobody has is nothing happening."""
    name = str(name or "").strip()
    if not holder or not name:
        return 0
    qty = int(qty or 1)
    with db.writing() as con:
        row = con.execute(
            "SELECT id, qty FROM holding WHERE holder = ? AND lower(name) = lower(?)", (holder, name)
        ).fetchone()
        if not row:
            return 0
        left = int(row["qty"]) - qty
        if left <= 0:
            con.execute("DELETE FROM holding WHERE id = ?", (row["id"],))
            return int(row["qty"])
        con.execute("UPDATE holding SET qty = ? WHERE id = ?", (left, row["id"]))
        return qty


def transfer(src, dst, name, qty=1, turn_id=None):
    """Move a thing between two holders. Either side may be nothing — bread is
    eaten, wood is cut — and a holder cannot hand over what it does not have."""
    qty = int(qty or 1)
    note, worn = "", False
    if src:
        row = held(src, name)
        if not row:
            return 0
        note, worn = row["note"] or "", bool(row["worn"])
        qty = take(src, name, qty)
        if not qty:
            return 0
    if dst:
        give(dst, name, qty, note=note, worn=worn, turn_id=turn_id)
    return qty


def holdings_at(place_id):
    """What everything at a place is holding — the place's own stock and whatever
    stands in it."""
    place_id = slug(place_id)
    if not place_id:
        return []
    out = []
    for holder in [place_id] + contains(place_id):
        items = holdings(holder)
        if not items:
            continue
        entity = find_entity(holder)
        out.append({
            "id": holder,
            "name": entity["name"] if entity else holder.replace("-", " "),
            "items": items,
        })
    return out
