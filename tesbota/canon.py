import json
import re

from . import db
from .config import (
    EXPLORER,
    EXPLORERS,
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


SMALL = {"a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into",
         "nor", "of", "on", "onto", "or", "over", "the", "to", "up", "upon", "with"}


def titled(name):
    """A thing is named the way a title is set: every word but the small joining
    ones in the middle, and a word that already capitalises itself is left alone."""
    words = str(name or "").split()
    out = []
    for at, word in enumerate(words):
        if word[1:] != word[1:].lower():
            out.append(word)
        elif at and at < len(words) - 1 and word.lower().strip(",.:;") in SMALL:
            out.append(word.lower())
        else:
            out.append(word[:1].upper() + word[1:])
    return " ".join(out)


def find_entity(entity_id):
    return db.row("SELECT * FROM entity WHERE id = ?", (slug(entity_id),))


def ensure_entity(kind, entity_id, name=None, turn_id=None, author=None):
    entity_id = slug(entity_id)
    if kind not in KINDS:
        kind = "places"
    name = name or entity_id.replace("-", " ")
    if kind in ("items", "books"):
        name = titled(name)
    with db.writing() as con:
        con.execute(
            "INSERT OR IGNORE INTO entity (id, kind, name, introduced) VALUES (?,?,?,?)",
            (entity_id, kind, name, turn_id),
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
SPELLED = re.compile(r"\[([^\]]*)\]\(bota://[^)]*\)")
QUOTED = re.compile("\"[^\"]*\"|\u201c[^\u201d]*\u201d")
SHORTEST_NAME = 3


def plain(text):
    """What a link says, without where it points. The adventurer reads a terminal,
    not the library."""
    return SPELLED.sub(r"\1", text or "")


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
    for r in db.rows("SELECT id, name FROM entity WHERE kind = 'places' ORDER BY id"):
        nodes[r["id"]] = {"name": r["name"]}
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

    return "\n".join(out)


def thing(name, kind="items", turn_id=None):
    """Everything anybody carries is a thing the world has a row for. Naming one
    that has none writes it down, the same as naming a place."""
    ident = slug(name)
    if not ident:
        return None
    if not find_entity(ident):
        with db.writing() as con:
            con.execute(
                "INSERT OR IGNORE INTO entity (id, kind, name, introduced) VALUES (?,?,?,?)",
                (ident, kind, titled(name), turn_id),
            )
            con.execute("INSERT OR IGNORE INTO item (id) VALUES (?)", (ident,))
    return ident


STATS = ("type", "weight", "worth", "owed_by", "rarity", "slot")


def describe(name, effects=None, **stats):
    """What a thing is, written on the thing itself. A kind of thing the world has
    not met yet gets a row here before anybody is handed one."""
    item = thing(name)
    if not item:
        return None
    known = {k: v for k, v in stats.items() if k in STATS and v is not None}
    if known:
        sets = ", ".join(f"{k} = ?" for k in known)
        with db.writing() as con:
            con.execute(f"UPDATE item SET {sets} WHERE id = ?", (*known.values(), item))
    for stat, amount in (effects or {}).items():
        affect(item, stat, amount)
    return item


def affect(item, stat, amount):
    """What a thing does is a row for each stat it moves, so a ring worth +1 dex
    costs the world no column."""
    with db.writing() as con:
        con.execute(
            "INSERT INTO effect (item, stat, amount) VALUES (?, ?, ?) "
            "ON CONFLICT (item, stat) DO UPDATE SET amount = excluded.amount",
            (slug(item), stat, str(amount)),
        )


def effects(items):
    """What each of these things does, by id."""
    items = [slug(i) for i in items]
    if not items:
        return {}
    marks = ",".join("?" * len(items))
    out = {}
    for r in db.rows(
        f"SELECT item, stat, amount FROM effect WHERE item IN ({marks}) ORDER BY id",
        tuple(items),
    ):
        out.setdefault(r["item"], []).append({"stat": r["stat"], "amount": r["amount"]})
    return out


def does(effects):
    """What a thing does, said in a line. Each amount carries its own sign, so a
    stat nobody has thought of yet reads the same as damage does."""
    pairs = effects.items() if isinstance(effects, dict) else (
        (e["stat"], e["amount"]) for e in effects or []
    )
    return ", ".join(f"{amount} {stat}" for stat, amount in pairs)


def held(holder, name):
    return db.row(
        "SELECT * FROM holding WHERE holder = ? AND item = ?", (holder, slug(name))
    )


def holdings(holder):
    rows = db.rows(
        """SELECT h.item, h.qty, h.worn, e.name, e.about, i.type, i.weight,
                  i.slot, i.rarity
             FROM holding h
             LEFT JOIN entity e ON e.id = h.item
             LEFT JOIN item i ON i.id = h.item
            WHERE h.holder = ? ORDER BY h.id""",
        (holder,),
    )
    powers = effects([r["item"] for r in rows])
    return [
        {
            "item": r["item"],
            "name": r["name"] or r["item"].replace("-", " "),
            "type": r["type"],
            "slot": r["slot"],
            "rarity": r["rarity"],
            "about": r["about"] or "",
            "weight": r["weight"],
            "effects": powers.get(r["item"], []),
            "qty": r["qty"],
            "worn": bool(r["worn"]),
        }
        for r in rows
    ]


def aspect(name, applies=None, ability=None, about=None):
    """An aspect is a thing in its own right — `citizen`, `sworn`, `cursed` — that
    other things can be marked with. What it grants is written on the aspect, not on
    everybody wearing it."""
    ident = ensure_entity("aspects", slug(name), name=str(name))
    with db.writing() as con:
        con.execute("INSERT OR IGNORE INTO aspect (id) VALUES (?)", (ident,))
        if applies is not None:
            con.execute("UPDATE aspect SET applies = ? WHERE id = ?", (applies, ident))
        if ability is not None:
            con.execute(
                "UPDATE aspect SET ability = ? WHERE id = ?",
                (json.dumps(ability, ensure_ascii=False) if ability else None, ident),
            )
        if about is not None:
            con.execute("UPDATE entity SET about = ? WHERE id = ?", (about, ident))
    return ident


def tag(entity_id, aspect_id, value=None):
    """Mark a thing with an aspect. `value` is what the aspect is of — the place a
    citizen belongs to, the house somebody is sworn into."""
    with db.writing() as con:
        con.execute(
            "INSERT OR IGNORE INTO tagged (entity, aspect, value) VALUES (?,?,?)",
            (slug(entity_id), slug(aspect_id), str(value) if value else None),
        )
    return True


def untag(entity_id, aspect_id, value=None):
    with db.writing() as con:
        con.execute(
            "DELETE FROM tagged WHERE entity = ? AND aspect = ? "
            "AND coalesce(value, '') = coalesce(?, '')",
            (slug(entity_id), slug(aspect_id), str(value) if value else None),
        )
    return True


def aspects_of(entity_id):
    """Everything a thing is marked with, and what each marking grants."""
    return [
        {
            "aspect": r["aspect"],
            "name": r["name"] or r["aspect"].replace("-", " "),
            "value": r["value"],
            "of": r["of_name"],
            "applies": r["applies"],
            "ability": json.loads(r["ability"]) if r["ability"] else None,
        }
        for r in db.rows(
            """SELECT t.aspect, t.value, e.name, a.applies, a.ability,
                      (SELECT ve.name FROM entity ve WHERE ve.id = t.value) AS of_name
                 FROM tagged t
                 LEFT JOIN entity e ON e.id = t.aspect
                 LEFT JOIN aspect a ON a.id = t.aspect
                WHERE t.entity = ? ORDER BY t.id""",
            (slug(entity_id),),
        )
    ]


def bearing_aspect(aspect_id, value=None):
    """Everything marked with an aspect — every citizen of Alheim."""
    sql = "SELECT entity, value FROM tagged WHERE aspect = ?"
    args = [slug(aspect_id)]
    if value:
        sql += " AND value = ?"
        args.append(str(value))
    return [dict(r) for r in db.rows(sql + " ORDER BY entity", tuple(args))]


def holders():
    """Everyone with something to their name. The explorer is one of them and is
    not an entity, because the one moving through this world is never a subject
    of the library."""
    out = []
    for r in db.rows("SELECT DISTINCT holder FROM holding ORDER BY holder"):
        walker = r["holder"] in EXPLORERS.values()
        entity = None if walker else find_entity(r["holder"])
        out.append({
            "id": r["holder"],
            "name": entity["name"] if entity else r["holder"].replace("-", " "),
            "kind": entity["kind"] if entity else None,
            "explorer": walker,
        })
    return out


def give(holder, name, qty=1, worn=False, turn_id=None):
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
                "INSERT INTO holding (holder, item, qty, worn, turn_id) VALUES (?,?,?,?,?)",
                (holder, item, qty, int(bool(worn)), turn_id),
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


def owe(holder, name, qty=1):
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
                "INSERT INTO holding (holder, item, qty) VALUES (?,?,?)",
                (holder, item, left),
            )
        return left


def transfer(src, dst, name, qty=1, turn_id=None):
    """Move a thing between two holders. Either side may be nothing — bread is eaten,
    wood is cut. A holder may hand over to somebody what they do not have, going short
    by it, which is how a promise is written down; nothing can be owed to the world."""
    qty = int(qty or 1)
    worn = False
    if src:
        row = held(src, name)
        if row:
            worn = bool(row["worn"])
        if dst:
            owe(src, name, qty)
        else:
            qty = take(src, name, qty)
            if not qty:
                return 0
    if dst:
        give(dst, name, qty, worn=worn, turn_id=turn_id)
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
