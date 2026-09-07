"use client";

import { useEffect, useState } from "react";
import { Cap, Empty, Note } from "./ui";

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

export default function Map({ where = [], at }) {
  const [layout, setLayout] = useState(null);

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

  if (!layout) return <Empty>solving the map…</Empty>;
  if (layout.error) return <Note tone="warn">{layout.error}</Note>;

  const world = tree(layout.places);
  const nodes = [];
  let offset = 0;
  for (const root of world.roots) {
    const size = measure(root, world);
    pin(size, world, offset + size.w / 2, size.h / 2, 0, nodes);
    offset += size.w + PAD * 2;
  }

  const here = where[where.length - 1]?.id || null;
  const spot = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const floating = layout.floating.map((id) => layout.places[id]);

  if (!nodes.length) {
    return (
      <div className="map">
        <svg className="mapsvg" viewBox="0 0 100 60" preserveAspectRatio="xMidYMid meet" />
        <Cap>nowhere has been placed yet</Cap>
      </div>
    );
  }

  const bounds = nodes.reduce(
    (box, n) => ({
      minX: Math.min(box.minX, n.x - n.size.w / 2),
      maxX: Math.max(box.maxX, n.x + n.size.w / 2),
      minY: Math.min(box.minY, n.y - n.size.h / 2),
      maxY: Math.max(box.maxY, n.y + n.size.h / 2),
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  );
  const view = [
    bounds.minX - PAD,
    bounds.minY - PAD,
    bounds.maxX - bounds.minX + PAD * 2,
    bounds.maxY - bounds.minY + PAD * 2,
  ];

  return (
    <div className="map">
      <svg className="mapsvg" viewBox={view.join(" ")} preserveAspectRatio="xMidYMid meet">
        {nodes
          .filter((n) => n.size.kids.length)
          .map((n) => (
            <g key={`region-${n.id}`}>
              <rect
                className={`mregion${n.place.unwritten ? " unwritten" : ""}${
                  n.id === here ? " here" : ""
                }`}
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
                className={`mplace${n.place.unwritten ? " unwritten" : ""}${
                  n.id === here ? " here" : ""
                }`}
              >
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
        <p className="cap">nowhere in particular</p>
        {floating.length === 0 && <p className="mfloat">every place is placed</p>}
        {floating.map((p) => (
          <p className={`mfloat${p.unwritten ? " unwritten" : ""}`} key={p.name}>
            {p.name}
          </p>
        ))}
      </div>
    </div>
  );
}
