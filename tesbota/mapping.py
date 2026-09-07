import json
import math
import random

from . import db, travel

SEED = 1729
ROUNDS = 600
NOMINAL = 600.0
MIN_GAP = 140.0
NUDGE = 0.35
PULL = 0.2


def places():
    unwritten = {r["id"] for r in db.rows("SELECT id FROM unwritten")}
    known = {
        r["id"]: {
            "name": r["name"],
            "extent": r["extent"],
            "parent": None,
            "children": [],
            "unwritten": r["id"] in unwritten,
        }
        for r in db.rows("SELECT id, name, extent FROM entity WHERE kind = 'places' ORDER BY id")
    }
    for r in db.rows("SELECT src, dst FROM edge WHERE rel = 'within' ORDER BY src"):
        if r["src"] in known and r["dst"] in known and r["src"] != r["dst"]:
            known[r["src"]]["parent"] = r["dst"]
            known[r["dst"]]["children"].append(r["src"])
    return known


def roads(known):
    out = []
    for r in db.rows("SELECT src, dst, bearing, distance FROM edge WHERE rel = 'exits' ORDER BY src, dst"):
        if r["src"] not in known or r["dst"] not in known:
            continue
        out.append({
            "src": r["src"],
            "dst": r["dst"],
            "bearing": r["bearing"] or "",
            "distance": r["distance"] or "",
            "degrees": travel.bearing_degrees(r["bearing"]),
            "band": travel.distance_band(r["distance"]),
        })
    return out


def centre(extent):
    """The middle of a measured shape, so a place the world has surveyed can be
    pinned rather than solved."""
    try:
        shape = json.loads(extent)
    except (TypeError, ValueError):
        return None
    points = []

    def walk(node):
        if not isinstance(node, list):
            return
        if len(node) == 2 and all(isinstance(v, (int, float)) for v in node):
            points.append((float(node[0]), float(node[1])))
            return
        for child in node:
            walk(child)

    walk((shape or {}).get("coordinates"))
    if not points:
        return None
    return [sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points)]


def heading(degrees):
    rad = math.radians(degrees)
    return math.sin(rad), math.cos(rad)


def anchors(edges):
    out = set()
    for e in edges:
        if e["degrees"] is not None or e["band"]:
            out.add(e["src"])
            out.add(e["dst"])
    return out


def confidences(known, edges):
    anchored = anchors(edges)
    out = {}
    for ident, place in known.items():
        if place["extent"] and centre(place["extent"]):
            out[ident] = "fixed"
        elif ident in anchored:
            out[ident] = "constrained"
    for ident, place in known.items():
        if ident in out:
            continue
        if any(kid in out for kid in place["children"]):
            out[ident] = "constrained"
    for ident in known:
        out.setdefault(ident, "floating")
    return out


def seeded(known, edges, confidence, rng):
    """Lay the graph out once by following its bearings, so relaxation starts
    from something already roughly right."""
    at = {}
    for ident, place in known.items():
        if confidence[ident] == "fixed":
            at[ident] = centre(place["extent"])

    out = {}
    for e in edges:
        out.setdefault(e["src"], []).append(e)
        out.setdefault(e["dst"], []).append(dict(
            e, src=e["dst"], dst=e["src"],
            degrees=None if e["degrees"] is None else (e["degrees"] + 180) % 360,
        ))

    placed = [i for i in sorted(known) if confidence[i] != "floating"]
    for start in placed:
        if start in at:
            continue
        at[start] = [0.0, 0.0]
        queue = [start]
        while queue:
            here = queue.pop(0)
            for e in out.get(here, []):
                if e["dst"] in at or confidence.get(e["dst"]) == "floating":
                    continue
                span = sum(e["band"]) / 2 if e["band"] else NOMINAL
                if e["degrees"] is None:
                    angle = rng.random() * 2 * math.pi
                    step = (math.sin(angle), math.cos(angle))
                else:
                    step = heading(e["degrees"])
                at[e["dst"]] = [at[here][0] + step[0] * span, at[here][1] + step[1] * span]
                queue.append(e["dst"])

    for ident in placed:
        if ident not in at:
            angle = rng.random() * 2 * math.pi
            at[ident] = [math.sin(angle) * NOMINAL * 3, math.cos(angle) * NOMINAL * 3]
    return at


def shift(at, fixed, a, b, dx, dy):
    if a in fixed and b in fixed:
        return
    if a in fixed:
        at[b][0] += dx
        at[b][1] += dy
        return
    if b in fixed:
        at[a][0] -= dx
        at[a][1] -= dy
        return
    at[a][0] -= dx / 2
    at[a][1] -= dy / 2
    at[b][0] += dx / 2
    at[b][1] += dy / 2


def relax(at, known, edges, confidence, rounds):
    fixed = {i for i, c in confidence.items() if c == "fixed"}
    anchored = anchors(edges)
    live = [e for e in edges if e["src"] in at and e["dst"] in at]
    ids = sorted(at)

    for _ in range(rounds):
        for e in live:
            a, b = e["src"], e["dst"]
            vx, vy = at[b][0] - at[a][0], at[b][1] - at[a][1]
            span = math.hypot(vx, vy) or 1e-6

            if e["degrees"] is not None:
                sx, sy = heading(e["degrees"])
                shift(at, fixed, a, b, (sx * span - vx) * NUDGE, (sy * span - vy) * NUDGE)
                vx, vy = at[b][0] - at[a][0], at[b][1] - at[a][1]
                span = math.hypot(vx, vy) or 1e-6

            if e["band"]:
                low, high = e["band"]
                want = min(max(span, low), high)
                grow = (want - span) / span * NUDGE
                shift(at, fixed, a, b, vx * grow, vy * grow)

        for ident in ids:
            if ident in fixed or ident in anchored:
                continue
            kids = [k for k in known[ident]["children"] if k in at]
            if not kids:
                continue
            mx = sum(at[k][0] for k in kids) / len(kids)
            my = sum(at[k][1] for k in kids) / len(kids)
            at[ident][0] += (mx - at[ident][0]) * PULL
            at[ident][1] += (my - at[ident][1]) * PULL

        for n, a in enumerate(ids):
            for b in ids[n + 1:]:
                vx, vy = at[b][0] - at[a][0], at[b][1] - at[a][1]
                span = math.hypot(vx, vy)
                if span >= MIN_GAP:
                    continue
                if span < 1e-6:
                    vx, vy, span = MIN_GAP, 0.0, MIN_GAP
                push = (MIN_GAP - span) / span * 0.25
                shift(at, fixed, a, b, vx * push, vy * push)
    return at


def walked():
    """Everywhere the explorer has actually stood. The turn records are read
    once and the answer is kept on the campaign."""
    from .state import all_turns, load_campaign, save_campaign

    campaign = load_campaign()
    seen = set(campaign.get("walked") or [])
    mark = campaign.get("walked_through") or ""
    latest = mark
    for turn in all_turns():
        if turn["turn_id"] <= mark:
            continue
        latest = max(latest, turn["turn_id"])
        for step in turn.get("location_path") or []:
            ident = step.get("id") if isinstance(step, dict) else step
            if ident:
                seen.add(ident)

    if latest != mark or seen != set(campaign.get("walked") or []):
        fresh = load_campaign()
        fresh["walked"] = sorted(seen)
        fresh["walked_through"] = latest
        save_campaign(fresh)
    return seen


def knowledge(ident, place, been):
    if ident in been:
        return "walked"
    return "named" if place["unwritten"] else "recorded"


def solve(seed=SEED, rounds=ROUNDS):
    known = places()
    edges = roads(known)
    confidence = confidences(known, edges)
    at = relax(seeded(known, edges, confidence, random.Random(seed)), known, edges, confidence, rounds)
    return {
        ident: {
            "x": round(at[ident][0], 3) if ident in at else None,
            "y": round(at[ident][1], 3) if ident in at else None,
            "fixed": confidence[ident] == "fixed",
            "confidence": confidence[ident],
        }
        for ident in sorted(known)
    }


def layout(seed=SEED, rounds=ROUNDS):
    known = places()
    solved = solve(seed=seed, rounds=rounds)
    been = walked()
    return {
        "seed": seed,
        "places": {
            ident: {
                "name": known[ident]["name"],
                "parent": known[ident]["parent"],
                "children": sorted(known[ident]["children"]),
                "unwritten": known[ident]["unwritten"],
                "extent": known[ident]["extent"],
                "knowledge": knowledge(ident, known[ident], been),
                **solved[ident],
            }
            for ident in solved
        },
        "roads": roads(known),
        "floating": [i for i, m in solved.items() if m["confidence"] == "floating"],
    }
