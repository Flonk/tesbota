import re

from . import db
from .config import (
    EXPLORER,
    FORBIDDEN_AUTHORS,
    GODHEADS,
    KINDS,
    NARRATOR,
    STUB,
    TRAITS,
    TRAITS_ROLLED,
    WEIGHT,
)

ATTESTED = "attested"


def slug(text):
    return "-".join(str(text or "").replace("'", "").replace("\u2019", "").split()).strip("-").lower()


def find_entity(entity_id):
    return db.row("SELECT * FROM entity WHERE id = ?", (slug(entity_id),))


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


def passages(book_id):
    return db.rows("SELECT * FROM passage WHERE book_id = ? ORDER BY ord", (slug(book_id),))


def passage(book_id, ord):
    return db.row("SELECT * FROM passage WHERE book_id = ? AND ord = ?", (slug(book_id), ord))


def contains(place_id):
    return [r["id"] for r in db.rows("SELECT id FROM place WHERE parent = ? ORDER BY id", (slug(place_id),))]


def ancestry(place_id):
    rows = db.rows(
        """
        WITH RECURSIVE up(id, depth) AS (
          SELECT ?, 0
          UNION
          SELECT p.parent, up.depth + 1 FROM place p JOIN up ON p.id = up.id WHERE up.depth < 24 AND p.parent IS NOT NULL
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
            "chronicle": (r["author"] or "").strip() == NARRATOR,
        })
    return shelf


def given_names():
    """First names already spoken for, so a new life is not named after somebody
    who is already in the world or after an explorer who has already lived."""
    try:
        people = db.rows("SELECT name FROM entity WHERE kind = 'people'")
        lives = db.rows("SELECT e.name FROM book b JOIN entity e ON e.id = b.id WHERE b.author = ?", (NARRATOR,))
    except Exception:
        return set()
    taken = {(r["name"] or "").split(" ")[0].lower() for r in people}
    for r in lives:
        rest = (r["name"] or "").removeprefix("The Life of ").split(" ")
        taken.add(rest[0].lower())
    return taken - {""}


def roll_traits(rng=None, how_many=TRAITS_ROLLED):
    """Three traits, drawn against their rarity. Nobody is picked twice."""
    import random as _random

    rng = rng or _random
    pool = list(TRAITS)
    picked = []
    while pool and len(picked) < how_many:
        weights = [WEIGHT.get(r, 0.1) for _, r in pool]
        trait, _ = rng.choices(pool, weights=weights, k=1)[0]
        picked.append(trait)
        pool = [(t, r) for t, r in pool if t != trait]
    return picked


def traits(entity_id, roll=False, rng=None):
    """What somebody is like. Rolled once, the first time anybody asks."""
    ident = slug(entity_id)
    row = db.row("SELECT traits FROM person WHERE id = ?", (ident,))
    if row and (row["traits"] or "").strip():
        return [t.strip() for t in row["traits"].split(",") if t.strip()]
    if not roll:
        return []
    picked = roll_traits(rng)
    with db.writing() as con:
        con.execute("INSERT OR IGNORE INTO person (id) VALUES (?)", (ident,))
        con.execute("UPDATE person SET traits = ? WHERE id = ?", (", ".join(picked), ident))
    return picked


def person(entity_id):
    return db.row(
        """
        SELECT p.id, p.work, p.lives, p.born, p.died, p.traits,
               coalesce(l.name, replace(p.lives, '-', ' ')) AS lives_name
          FROM person p LEFT JOIN entity l ON l.id = p.lives
         WHERE p.id = ?
        """,
        (slug(entity_id),),
    )


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
    """Run every passage past the linker, so a name in a book is an
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
                touched += 1
        for r in con.execute("SELECT id, about FROM entity WHERE about IS NOT NULL").fetchall():
            linked = link_names(r["about"])
            if linked != r["about"]:
                con.execute("UPDATE entity SET about = ? WHERE id = ?", (linked, r["id"]))
                touched += 1
    return touched


def illegal_books():
    return [
        r["id"] for r in db.rows("SELECT id, lower(trim(author)) a FROM book")
        if r["a"] in FORBIDDEN_AUTHORS
    ]


def graph():
    nodes, edges, links = {}, [], []
    unwritten = {r["id"] for r in db.rows("SELECT id FROM unwritten")}
    for r in db.rows("SELECT id, name FROM entity WHERE kind = 'places' ORDER BY id"):
        nodes[r["id"]] = {"name": r["name"], "stub": r["id"] in unwritten}
    for r in db.rows("SELECT id, parent FROM place WHERE parent IS NOT NULL ORDER BY id"):
        links.append((r["parent"], r["id"]))
    for r in db.rows("SELECT src, dst, bearing, distance FROM way ORDER BY src, dst"):
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


def thing(name, kind="items", turn_id=None):
    """Everything anybody carries is a thing the world has a row for. Naming one
    that has none writes it down, the same as naming a place."""
    ident = slug(name)
    if not ident:
        return None
    if not find_entity(ident):
        title = str(name).strip()
        with db.writing() as con:
            con.execute(
                "INSERT OR IGNORE INTO entity (id, kind, name, introduced) VALUES (?,?,?,?)",
                (ident, kind, title[:1].upper() + title[1:], turn_id),
            )
            con.execute("INSERT OR IGNORE INTO item (id) VALUES (?)", (ident,))
    return ident


def held(holder, name):
    return db.row(
        "SELECT * FROM holding WHERE holder = ? AND item = ?", (holder, slug(name))
    )


def holdings(holder):
    return [
        {
            "item": r["item"],
            "name": r["name"] or r["item"].replace("-", " "),
            "type": r["type"],
            "qty": r["qty"],
            "note": r["note"] or "",
            "worn": bool(r["worn"]),
        }
        for r in db.rows(
            """SELECT h.item, h.qty, h.note, h.worn, e.name, i.type
                 FROM holding h
                 LEFT JOIN entity e ON e.id = h.item
                 LEFT JOIN item i ON i.id = h.item
                WHERE h.holder = ? ORDER BY h.id""",
            (holder,),
        )
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
    item = thing(name, turn_id=turn_id)
    if not holder or not item:
        return 0
    qty = int(qty or 1)
    with db.writing() as con:
        row = con.execute(
            "SELECT id, qty FROM holding WHERE holder = ? AND item = ?", (holder, item)
        ).fetchone()
        if row:
            left = int(row["qty"]) + qty
            if left == 0:
                con.execute("DELETE FROM holding WHERE id = ?", (row["id"],))
            else:
                con.execute("UPDATE holding SET qty = ? WHERE id = ?", (left, row["id"]))
        else:
            con.execute(
                "INSERT INTO holding (holder, item, qty, note, worn, turn_id) VALUES (?,?,?,?,?,?)",
                (holder, item, qty, str(note or ""), int(bool(worn)), turn_id),
            )
    return qty


def take(holder, name, qty=1):
    """Give up what is asked for, or everything held if that is less. Taking
    what nobody has is nothing happening."""
    item = slug(name)
    if not holder or not item:
        return 0
    qty = int(qty or 1)
    with db.writing() as con:
        row = con.execute(
            "SELECT id, qty FROM holding WHERE holder = ? AND item = ?", (holder, item)
        ).fetchone()
        if not row:
            return 0
        left = int(row["qty"]) - qty
        if left <= 0:
            con.execute("DELETE FROM holding WHERE id = ?", (row["id"],))
            return int(row["qty"])
        con.execute("UPDATE holding SET qty = ? WHERE id = ?", (left, row["id"]))
        return qty


def strip(holder):
    """Everything a holder had, gone from them. Used when a life ends."""
    with db.writing() as con:
        return con.execute("DELETE FROM holding WHERE holder = ?", (holder,)).rowcount


def owe(holder, name, qty=1, note=""):
    """Take from a holder past what they have, leaving them short by the rest. A
    negative row is a debt somebody has written and is good for."""
    item = thing(name)
    if not holder or not item:
        return 0
    qty = int(qty or 1)
    with db.writing() as con:
        row = con.execute(
            "SELECT id, qty FROM holding WHERE holder = ? AND item = ?", (holder, item)
        ).fetchone()
        left = (int(row["qty"]) if row else 0) - qty
        if row and left == 0:
            con.execute("DELETE FROM holding WHERE id = ?", (row["id"],))
        elif row:
            con.execute("UPDATE holding SET qty = ? WHERE id = ?", (left, row["id"]))
        else:
            con.execute(
                "INSERT INTO holding (holder, item, qty, note) VALUES (?,?,?,?)",
                (holder, item, left, str(note or "")),
            )
        return left


def transfer(src, dst, name, qty=1, note="", turn_id=None):
    """Move a thing between two holders. Either side may be nothing — bread is eaten,
    wood is cut. A holder may hand over to somebody what they do not have, going short
    by it, which is how a promise is written down; nothing can be owed to the world."""
    qty = int(qty or 1)
    worn = False
    if src:
        row = held(src, name)
        if row:
            note = row["note"] or note
            worn = bool(row["worn"])
        if dst:
            owe(src, name, qty, note=note)
        else:
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
