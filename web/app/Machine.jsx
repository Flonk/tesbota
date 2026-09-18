"use client";

import { useEffect, useMemo, useState } from "react";
import { Empty, Mark } from "./ui";

/**
 * The machine, drawn from the machine.
 *
 * Nothing about the shape of the world is written here. `/api/machine` serves
 * `cli/src/machine.ts` and this lays out whatever comes back, so a state added
 * to the table appears on this page without anybody touching it.
 */

const KIND = {
  agent: { tone: "agent", what: "an agent is asked" },
  roll: { tone: "roll", what: "the driver decides" },
  book: { tone: "book", what: "it is written down" },
  wait: { tone: "wait", what: "the world holds" },
  end: { tone: "end", what: "the turn closes" },
};

const BOX = { w: 132, h: 46 };
const GAP = { x: 78, y: 34 };
const PAD = 30;

/**
 * Layered layout. Ranks come from the longest path along the flow, not the
 * shortest, so `done` sits at the end where it belongs instead of being dragged
 * left by the one edge `explorer` has straight to it. Cycles are broken first —
 * a redraft going back to `gm` must not decide anybody's column.
 */
function layout(states, edges) {
  const names = states.map((s) => s.name);
  const forward = edges.filter((e) => e.from !== e.to);

  // Break cycles: any edge reaching a state still open on the walk is a way back.
  const out = new Map(names.map((n) => [n, []]));
  for (const e of forward) out.get(e.from)?.push(e.to);
  const back = new Set();
  const open = new Set();
  const shut = new Set();
  const walk = (at) => {
    open.add(at);
    for (const next of out.get(at) || []) {
      if (open.has(next)) back.add(`${at}->${next}`);
      else if (!shut.has(next)) walk(next);
    }
    open.delete(at);
    shut.add(at);
  };
  walk("explorer");
  for (const n of names) if (!shut.has(n)) walk(n);

  const ahead = forward.filter((e) => !back.has(`${e.from}->${e.to}`));
  const into = new Map(names.map((n) => [n, []]));
  for (const e of ahead) into.get(e.to)?.push(e.from);

  // Longest path: a state sits one past the last thing that can reach it.
  const rank = new Map();
  const rankOf = (n, seen = new Set()) => {
    if (rank.has(n)) return rank.get(n);
    if (seen.has(n)) return 0;
    seen.add(n);
    const from = into.get(n) || [];
    const r = from.length ? Math.max(...from.map((f) => rankOf(f, seen) + 1)) : 0;
    rank.set(n, r);
    return r;
  };
  for (const n of names) rankOf(n);

  const ranks = new Map();
  for (const n of names) {
    const r = rank.get(n);
    if (!ranks.has(r)) ranks.set(r, []);
    ranks.get(r).push(n);
  }
  const order = [...ranks].sort((a, b) => a[0] - b[0]);

  // Barycentre: put each state opposite the average of what feeds it, a few
  // passes each way, which is most of what a crossing-free drawing needs.
  const row = new Map();
  for (const [, names_] of order) names_.forEach((n, i) => row.set(n, i));
  const neighbours = (n, dir) =>
    forward.filter((e) => (dir === "up" ? e.to === n : e.from === n))
           .map((e) => (dir === "up" ? e.from : e.to));
  for (let pass = 0; pass < 6; pass++) {
    const dir = pass % 2 ? "down" : "up";
    const lanes = dir === "up" ? order : [...order].reverse();
    for (const [, names_] of lanes) {
      const weight = new Map(
        names_.map((n) => {
          const near = neighbours(n, dir).map((m) => row.get(m)).filter((x) => x != null);
          return [n, near.length ? near.reduce((a, b) => a + b, 0) / near.length : row.get(n)];
        })
      );
      names_.sort((a, b) => weight.get(a) - weight.get(b) || a.localeCompare(b));
      names_.forEach((n, i) => row.set(n, i));
    }
  }

  const tallest = Math.max(...order.map(([, n]) => n.length));
  const full = tallest * BOX.h + (tallest - 1) * GAP.y;
  const place = new Map();
  for (const [d, names_] of order) {
    const span = names_.length * BOX.h + (names_.length - 1) * GAP.y;
    const top = PAD + (full - span) / 2;
    names_.forEach((name, n) => {
      place.set(name, { x: PAD + d * (BOX.w + GAP.x), y: top + n * (BOX.h + GAP.y) });
    });
  }

  return {
    place,
    width: PAD * 2 + order.length * BOX.w + (order.length - 1) * GAP.x,
    height: PAD * 2 + full,
  };
}

/** Where an edge leaves and lands, and the curve between. A self-edge loops above. */
function wire(from, to) {
  if (!from || !to) return null;
  const a = { x: from.x + BOX.w / 2, y: from.y + BOX.h / 2 };
  const b = { x: to.x + BOX.w / 2, y: to.y + BOX.h / 2 };

  if (from === to) {
    const top = from.y;
    const l = from.x + BOX.w * 0.28;
    const r = from.x + BOX.w * 0.72;
    return {
      d: `M ${l} ${top} C ${l - 16} ${top - 40}, ${r + 16} ${top - 40}, ${r} ${top}`,
      mid: { x: from.x + BOX.w / 2, y: top - 28 },
      back: false,
    };
  }

  const back = b.x < a.x;
  const start = { x: a.x + (b.x > a.x ? BOX.w / 2 : -BOX.w / 2), y: a.y };
  const end = { x: b.x + (b.x > a.x ? -BOX.w / 2 : BOX.w / 2), y: b.y };
  if (Math.abs(b.x - a.x) < 1) {
    const side = from.x + BOX.w + 22;
    return {
      d: `M ${from.x + BOX.w} ${a.y} C ${side + 30} ${a.y}, ${side + 30} ${b.y}, ${to.x + BOX.w} ${b.y}`,
      mid: { x: side + 26, y: (a.y + b.y) / 2 },
      back,
    };
  }
  const bow = back ? Math.min(70, Math.abs(b.y - a.y) / 2 + 34) : 0;
  const lift = back ? -bow : 0;
  const c1 = { x: start.x + (end.x - start.x) * 0.45, y: start.y + lift };
  const c2 = { x: start.x + (end.x - start.x) * 0.55, y: end.y + lift };
  return {
    d: `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`,
    mid: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 + lift * 0.75 },
    back,
  };
}

export default function Machine({ status }) {
  const [table, setTable] = useState(null);
  const [wrong, setWrong] = useState(null);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    let live = true;
    fetch("/api/machine", { cache: "no-store" })
      .then((r) => r.json())
      .then((t) => live && (t.error ? setWrong(t.error) : setTable(t)))
      .catch((e) => live && setWrong(String(e)));
    return () => {
      live = false;
    };
  }, []);

  const here = status?.state || null;
  const took = status?.took || null;

  const plan = useMemo(
    () => (table ? layout(table.states, table.edges) : null),
    [table]
  );

  if (wrong) return <Empty>the machine would not describe itself — {wrong}</Empty>;
  if (!table || !plan) return <Empty>reading the machine…</Empty>;

  const live = took ? `${took.from}->${took.to}` : null;
  const shown = hover
    ? table.edges.find((e) => e.id === hover)
    : took && table.edges.find((e) => e.from === took.from && e.to === took.to);

  return (
    <div className="machine">
      <div className="machinetop">
        <span className="cap dim">
          {table.states.length} states · {table.edges.length} edges
        </span>
        {here && (
          <span className="cap">
            <Mark name="pulse" gap=".35rem">
              now in <strong className="mnow">{here}</strong>
            </Mark>
          </span>
        )}
      </div>

      <div className="machinebox">
        <svg
          viewBox={`0 0 ${plan.width} ${plan.height}`}
          width={plan.width}
          height={plan.height}
          className="mgraph"
        >
          <defs>
            <marker id="mhead" viewBox="0 0 10 10" refX="9" refY="5"
                    markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="mheadfill" />
            </marker>
            <marker id="mheadlive" viewBox="0 0 10 10" refX="9" refY="5"
                    markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="mheadlivefill" />
            </marker>
          </defs>

          {table.edges.map((e) => {
            const path = wire(plan.place.get(e.from), plan.place.get(e.to));
            if (!path) return null;
            const isLive = live === `${e.from}->${e.to}`;
            const isHover = hover === e.id;
            return (
              <g key={e.id} className={`medge${isLive ? " live" : ""}${isHover ? " lit" : ""}`}
                 onMouseEnter={() => setHover(e.id)} onMouseLeave={() => setHover(null)}>
                <path d={path.d} className="mhit" />
                <path d={path.d} className="mline"
                      markerEnd={isLive ? "url(#mheadlive)" : "url(#mhead)"} />
                {isLive && <path d={path.d} className="mflow" />}
              </g>
            );
          })}

          {table.states.map((s) => {
            const at = plan.place.get(s.name);
            if (!at) return null;
            const isHere = here === s.name;
            const isFrom = took?.from === s.name;
            return (
              <g key={s.name} className={`mnode k-${KIND[s.kind]?.tone || "roll"}${isHere ? " here" : ""}${isFrom ? " from" : ""}`}>
                <rect x={at.x} y={at.y} width={BOX.w} height={BOX.h} rx="3" className="mbox" />
                <text x={at.x + BOX.w / 2} y={at.y + BOX.h / 2 - 3} className="mname">
                  {s.name}
                </text>
                <text x={at.x + BOX.w / 2} y={at.y + BOX.h / 2 + 12} className="mcalls">
                  {s.calls ? `${s.calls} call${s.calls > 1 ? "s" : ""}` : KIND[s.kind]?.tone}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {shown && (
        <p className="medgesaid">
          <strong>{shown.from}</strong>
          <span className="sep">—{shown.on}→</span>
          <strong>{shown.to}</strong>
          <span className="dim"> · {shown.when}</span>
        </p>
      )}

      <div className="mkey">
        {Object.entries(KIND).map(([kind, { tone, what }]) => (
          <span key={kind} className={`mkeyone k-${tone}`}>
            <i className="mswatch" />
            {kind} <span className="dim">— {what}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
