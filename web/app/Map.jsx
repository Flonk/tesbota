"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Cap, Empty, Note, openDossier } from "./ui";

const LEAF_W = 160;
const LEAF_H = 64;
const MARKER = LEAF_H / 8;
const TYPE = LEAF_W / 12;
const PAD = 30;
const GAP = 1.15;
const SPREAD = MARKER / 4;
const SQUASH = 0.35;
const SETTLE = 160;

function tree(places) {
  const placed = Object.entries(places).filter(([, p]) => p.x !== null);
  const known = Object.fromEntries(placed);
  const kids = {};
  const roots = [];
  for (const [id, place] of placed) {
    if (place.parent && known[place.parent]) (kids[place.parent] ||= []).push(id);
    else roots.push(id);
  }
  for (const list of Object.values(kids)) list.sort();
  return { known, kids, roots: roots.sort() };
}

function offsets(inner, world) {
  const ids = inner.map((c) => c.id);
  if (ids.length < 2) return { [ids[0]]: [0, 0] };

  const pairs = [];
  let apart = 0;
  let want = 0;
  for (let a = 0; a < ids.length; a++) {
    for (let b = a + 1; b < ids.length; b++) {
      const one = world.known[ids[a]];
      const two = world.known[ids[b]];
      const span = Math.hypot(two.x - one.x, two.y - one.y);
      const shown = Math.pow(span, SQUASH);
      pairs.push([ids[a], ids[b], shown]);
      apart += span;
      want += shown;
    }
  }

  const start = apart ? want / apart : 1;
  const at = Object.fromEntries(
    ids.map((id) => [id, [world.known[id].x * start, world.known[id].y * start]])
  );

  for (let round = 0; round < SETTLE; round++) {
    for (const [one, two, target] of pairs) {
      const vx = at[two][0] - at[one][0];
      const vy = at[two][1] - at[one][1];
      const span = Math.hypot(vx, vy) || 1e-6;
      const pull = ((target - span) / span) * 0.3;
      at[one][0] -= (vx * pull) / 2;
      at[one][1] -= (vy * pull) / 2;
      at[two][0] += (vx * pull) / 2;
      at[two][1] += (vy * pull) / 2;
    }
  }
  return at;
}

function measure(id, world) {
  const kids = world.kids[id] || [];
  if (!kids.length) return { id, w: LEAF_W, h: LEAF_H, scale: 1, kids: [], spots: {} };

  const inner = kids.map((k) => measure(k, world));
  const away = offsets(inner, world);

  let scale = 0;
  for (let a = 0; a < inner.length; a++) {
    for (let b = a + 1; b < inner.length; b++) {
      const one = away[inner[a].id];
      const two = away[inner[b].id];
      const apart = Math.hypot(two[0] - one[0], two[1] - one[1]);
      if (!apart) continue;
      const across = Math.abs(two[0] - one[0]) / apart;
      const along = Math.abs(two[1] - one[1]) / apart;
      const want =
        GAP *
        (across * ((inner[a].w + inner[b].w) / 2) + along * ((inner[a].h + inner[b].h) / 2));
      scale = Math.max(scale, want / apart);
    }
  }
  if (!scale) scale = 1;

  const spots = {};
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const child of inner) {
    const [ox, oy] = away[child.id];
    const px = ox * scale;
    const py = -oy * scale;
    spots[child.id] = [px, py];
    minX = Math.min(minX, px - child.w / 2);
    maxX = Math.max(maxX, px + child.w / 2);
    minY = Math.min(minY, py - child.h / 2);
    maxY = Math.max(maxY, py + child.h / 2);
  }
  return {
    id,
    scale,
    kids: inner,
    spots,
    w: maxX - minX + PAD * 2,
    h: maxY - minY + PAD * 2,
    box: { minX, maxX, minY, maxY },
  };
}

function pin(node, world, cx, cy, depth, out) {
  const place = world.known[node.id];
  out.push({ id: node.id, place, x: cx, y: cy, depth, size: node });
  if (!node.kids.length) return out;
  const midX = (node.box.minX + node.box.maxX) / 2;
  const midY = (node.box.minY + node.box.maxY) / 2;
  for (const child of node.kids) {
    const [px, py] = node.spots[child.id];
    pin(child, world, cx + px - midX, cy + py - midY, depth + 1, out);
  }
  return out;
}

function shape(place, at, scale) {
  let drawn;
  try {
    drawn = JSON.parse(place.extent);
  } catch {
    return null;
  }
  const rings = [];
  const walk = (node) => {
    if (!Array.isArray(node)) return;
    if (node.length && Array.isArray(node[0]) && typeof node[0][0] === "number") rings.push(node);
    else node.forEach(walk);
  };
  walk(drawn?.coordinates);
  if (!rings.length) return null;
  return rings
    .map(
      (ring) =>
        "M " +
        ring
          .map((p) => `${at.x + (p[0] - place.x) * scale} ${at.y - (p[1] - place.y) * scale}`)
          .join(" L ") +
        " Z"
    )
    .join(" ");
}

function drawn(layout) {
  if (!layout || layout.error) return { nodes: [], spot: {}, fit: null };
  const world = tree(layout.places);
  const nodes = [];
  let offset = 0;
  for (const root of world.roots) {
    const size = measure(root, world);
    pin(size, world, offset + size.w / 2, size.h / 2, 0, nodes);
    offset += size.w + PAD * 2;
  }
  if (!nodes.length) return { nodes, spot: {}, fit: null };

  const box = nodes.reduce(
    (b, n) => ({
      minX: Math.min(b.minX, n.x - n.size.w / 2),
      maxX: Math.max(b.maxX, n.x + n.size.w / 2),
      minY: Math.min(b.minY, n.y - n.size.h / 2),
      maxY: Math.max(b.maxY, n.y + n.size.h / 2),
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  );
  return {
    nodes,
    spot: Object.fromEntries(nodes.map((n) => [n.id, n])),
    fit: {
      x: box.minX - PAD,
      y: box.minY - PAD,
      w: box.maxX - box.minX + PAD * 2,
      h: box.maxY - box.minY + PAD * 2,
    },
  };
}

export default function Map({ where = [], at }) {
  const [layout, setLayout] = useState(null);
  const [view, setView] = useState(null);
  const svg = useRef(null);
  const grab = useRef(null);
  const touches = useRef({ at: {}, span: 0 });

  useEffect(() => {
    let live = true;
    fetch("/api/map", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { error: "the map could not be read" }))
      .then((m) => live && setLayout(m))
      .catch(() => live && setLayout({ error: "the map could not be read" }));
    return () => {
      live = false;
    };
  }, []);

  const { nodes, spot, fit } = useMemo(() => drawn(layout), [layout]);

  useEffect(() => {
    if (fit) setView((held) => held || { ...fit });
  }, [fit]);

  const framed = useCallback(() => {
    const box = svg.current?.getBoundingClientRect();
    if (!box || !view) return null;
    const k = Math.min(box.width / view.w, box.height / view.h);
    return {
      k,
      ox: box.left + (box.width - view.w * k) / 2,
      oy: box.top + (box.height - view.h * k) / 2,
    };
  }, [view]);

  const zoomAt = useCallback(
    (clientX, clientY, factor) => {
      setView((held) => {
        if (!held || !fit) return held;
        const f = framed();
        if (!f) return held;
        const px = held.x + (clientX - f.ox) / f.k;
        const py = held.y + (clientY - f.oy) / f.k;
        const w = Math.min(fit.w * 4, Math.max(fit.w / 12, held.w * factor));
        const step = w / held.w;
        return { x: px - (px - held.x) * step, y: py - (py - held.y) * step, w, h: held.h * step };
      });
    },
    [fit, framed]
  );

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const wheel = (e) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, Math.exp(e.deltaY * 0.0018));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [zoomAt]);

  function down(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    touches.current.at[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (Object.keys(touches.current.at).length === 1 && view) {
      grab.current = { from: { ...view }, x: e.clientX, y: e.clientY, moved: false };
    }
  }

  function move(e) {
    const held = touches.current.at[e.pointerId];
    if (!held) return;
    held.x = e.clientX;
    held.y = e.clientY;

    const down = Object.values(touches.current.at);
    if (down.length >= 2) {
      const [one, two] = down;
      const span = Math.hypot(two.x - one.x, two.y - one.y);
      const last = touches.current.span || span;
      touches.current.span = span;
      if (span > 0 && last > 0) zoomAt((one.x + two.x) / 2, (one.y + two.y) / 2, last / span);
      return;
    }

    const g = grab.current;
    const f = framed();
    if (!g || !f) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) g.moved = true;
    setView({ ...g.from, x: g.from.x - dx / f.k, y: g.from.y - dy / f.k });
  }

  function up(e) {
    delete touches.current.at[e.pointerId];
    if (Object.keys(touches.current.at).length < 2) touches.current.span = 0;
  }

  function tap(id) {
    if (grab.current?.moved) return;
    openDossier(id);
  }

  function centre(id) {
    const n = spot[id];
    setView((held) => (n && held ? { ...held, x: n.x - held.w / 2, y: n.y - held.h / 2 } : held));
  }

  if (!layout) return <Empty>solving the map…</Empty>;
  if (layout.error) return <Note tone="warn">{layout.error}</Note>;

  const here = where[where.length - 1]?.id || null;
  const floating = layout.floating.map((id) => layout.places[id]);

  if (!nodes.length || !view) {
    return (
      <div className="map">
        <svg className="mapsvg" viewBox="0 0 100 60" preserveAspectRatio="xMidYMid meet" />
        <div className="mapside">
          <Cap>nowhere has been placed yet</Cap>
        </div>
      </div>
    );
  }

  return (
    <div className="map">
      <svg
        className="mapsvg"
        ref={svg}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        {nodes
          .filter((n) => n.size.kids.length)
          .map((n) => (
            <g key={`region-${n.id}`} onClick={() => tap(n.id)}>
              <title>{n.place.name}</title>
              <rect
                className={`mregion ${n.place.knowledge}${n.id === here ? " here" : ""}`}
                x={n.x - n.size.w / 2}
                y={n.y - n.size.h / 2}
                width={n.size.w}
                height={n.size.h}
                rx="10"
              />
              <text
                className="mregionname"
                fontSize={TYPE}
                x={n.x - n.size.w / 2 + TYPE}
                y={n.y - n.size.h / 2 + TYPE * 1.6}
              >
                {n.place.name}
              </text>
            </g>
          ))}

        {layout.roads.map((road) => {
          const one = spot[road.src];
          const two = spot[road.dst];
          if (!one || !two) return null;
          const mx = (one.x + two.x) / 2;
          const my = (one.y + two.y) / 2;
          const room = Math.hypot(two.x - one.x, two.y - one.y) > LEAF_W * 1.5;
          return (
            <g key={`${road.src}-${road.dst}`} className="mroad">
              <title>
                {`${one.place.name} → ${two.place.name} · ${road.bearing || "no bearing recorded"} · ${
                  road.distance || "nobody has measured this"
                }`}
              </title>
              <line className="mreach" x1={one.x} y1={one.y} x2={two.x} y2={two.y} />
              <line x1={one.x} y1={one.y} x2={two.x} y2={two.y} />
              {road.distance && room && (
                <text className="mdist" fontSize={TYPE * 0.75} x={mx} y={my - TYPE * 0.4}>
                  {road.distance.length > 20 ? `${road.distance.slice(0, 18)}…` : road.distance}
                </text>
              )}
            </g>
          );
        })}

        {nodes
          .filter((n) => !n.size.kids.length || n.place.extent)
          .map((n) => {
            const path = n.place.extent ? shape(n.place, n, n.size.scale) : null;
            const size = MARKER + Math.min(4, (n.place.children || []).length) * SPREAD;
            return (
              <g
                key={n.id}
                className={`mplace ${n.place.knowledge}${n.id === here ? " here" : ""}`}
                onClick={() => tap(n.id)}
              >
                <title>{n.place.name}</title>
                {path ? <path className="mextent" d={path} /> : <circle cx={n.x} cy={n.y} r={size} />}
                {n.id === here && !path && (
                  <circle className="mhere" cx={n.x} cy={n.y} r={size + MARKER} />
                )}
                <text className="mname" fontSize={TYPE} x={n.x} y={n.y + size + TYPE * 1.4}>
                  {n.place.name}
                </text>
              </g>
            );
          })}
      </svg>

      <div className="mapside">
        {at && <div className="mapclock">{at}</div>}
        <div className="mapkeys">
          <button className="mkey" onClick={() => setView({ ...fit })}>
            fit
          </button>
          <button className="mkey" onClick={() => centre(here)} disabled={!here || !spot[here]}>
            find them
          </button>
        </div>
        <p className="cap">nowhere in particular</p>
        {floating.length === 0 && <p className="mfloat">every place is placed</p>}
        {floating.map((p) => (
          <p
            className={`mfloat ${p.knowledge}`}
            key={p.name}
            onClick={() => openDossier(Object.keys(layout.places).find((k) => layout.places[k] === p))}
          >
            {p.name}
          </p>
        ))}
      </div>
    </div>
  );
}
