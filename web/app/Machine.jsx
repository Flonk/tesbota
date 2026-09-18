"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Empty, Pill } from "./ui";

/**
 * The machine, drawn from the machine.
 *
 * Nothing about the shape of the world is written here. `/api/machine` serves
 * `cli/src/machine.ts` and this lays out whatever comes back, so a state added to
 * the table appears on this page without anybody touching it.
 *
 * The states are `Pill`, the same one the rest of the app uses. The edges are an
 * svg laid underneath at the same measured size, which is the only part of this
 * that has to know about pixels.
 */



const ROW = 24;   // how tall a pill sits
const LEAP = 26;  // the gap between one row and the next
const GUTTER = 30;  // the names are short now, so the columns get room to breathe
const PAD = 7;
const COLUMNS = 2;

/**
 * Two columns, running down, two to a line the whole way. Ranks come from the
 * longest path along the flow, so the order is the order the world moves in —
 * but a rank of one no longer takes a line to itself, because half the diagram
 * was blank and the thing has to fit a phone.
 */
function layout(states, edges, width) {
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
  const onward = new Map(names.map((n) => [n, []]));
  for (const e of ahead) {
    into.get(e.to)?.push(e.from);
    onward.get(e.from)?.push(e.to);
  }

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

  // Then let anything with slack fall as late as it may. Longest-path alone puts
  // `narrate` one step below `explorer`, because that is the only thing that
  // reaches it — but it is the end of a turn and belongs down by `done`.
  for (const n of [...names].sort((a, b) => rank.get(b) - rank.get(a))) {
    const next = onward.get(n) || [];
    if (!next.length) continue;
    const latest = Math.min(...next.map((m) => rank.get(m))) - 1;
    if (latest > rank.get(n)) rank.set(n, latest);
  }

  const ranks = new Map();
  for (const n of names) {
    const r = rank.get(n);
    if (!ranks.has(r)) ranks.set(r, []);
    ranks.get(r).push(n);
  }

  // Flow order, then two to a line. Within a rank the state more of the flow runs
  // through goes first, so the spine stays on the left where it can.
  const busy = (n) => forward.filter((e) => e.from === n || e.to === n).length;
  const flow = [...ranks]
    .sort((a, b) => a[0] - b[0])
    .flatMap(([, held]) => [...held].sort((a, b) => busy(b) - busy(a) || a.localeCompare(b)));

  const wide = Math.max(170, width);
  const cell = (wide - PAD * 2 - GUTTER * (COLUMNS - 1)) / COLUMNS;
  const place = new Map();
  for (let at = 0; at < flow.length; at += COLUMNS) {
    const row = at / COLUMNS;
    flow.slice(at, at + COLUMNS).forEach((name, n) => {
      place.set(name, {
        x: PAD + n * (cell + GUTTER),
        y: PAD + row * (ROW + LEAP),
        w: cell,
        row,
      });
    });
  }

  // The longest name has to fit the column it lands in, at any width, and the call
  // count rides beside it — so it is measured as part of the name rather than
  // discovered to be two characters too many once it is on the screen.
  const longest = Math.max(
    ...states.map((s) => s.name.length + (s.calls ? String(s.calls).length + 1 : 0))
  );
  const type = Math.max(7, Math.min(11, (cell - 12) / (longest * 0.62)));

  const rows = Math.ceil(flow.length / COLUMNS);
  return {
    place, type, width: wide,
    height: PAD * 2 + rows * ROW + (rows - 1) * LEAP,
  };
}

const mid = (at) => ({ x: at.x + at.w / 2, y: at.y + ROW / 2 });

/**
 * Where an edge leaves and lands. The flow runs down, so a forward edge drops out
 * of the bottom and a way back bows out to the side and climbs — which is what
 * makes a redraft legible as a redraft rather than as another step.
 */
function wire(from, to, width) {
  if (!from || !to) return null;
  const a = mid(from);
  const b = mid(to);

  if (from === to) {
    const right = from.x + from.w;
    return {
      d: `M ${right} ${a.y - 5} C ${right + 20} ${a.y - 15}, ${right + 20} ${a.y + 15}, ${right} ${a.y + 5}`,
    };
  }

  if (from.row === to.row) {
    const rightward = b.x > a.x;
    const start = rightward ? from.x + from.w : from.x;
    const end = rightward ? to.x : to.x + to.w;
    const lift = ROW / 2 + 9;
    return {
      d: `M ${start} ${a.y} C ${(start + end) / 2} ${a.y - lift}, ${(start + end) / 2} ${b.y - lift}, ${end} ${b.y}`,
    };
  }

  if (to.row > from.row) {
    const start = { x: a.x, y: from.y + ROW };
    const end = { x: b.x, y: to.y };
    const reach = (end.y - start.y) * 0.5;
    return {
      d: `M ${start.x} ${start.y} C ${start.x} ${start.y + reach}, ${end.x} ${end.y - reach}, ${end.x} ${end.y}`,
    };
  }

  // Climbing back. Leave by whichever flank is nearer the outside and run up it.
  const leftish = a.x < width / 2;
  const side = leftish
    ? Math.min(from.x, to.x) - 8
    : Math.max(from.x + from.w, to.x + to.w) + 8;
  const start = { x: leftish ? from.x : from.x + from.w, y: a.y };
  const end = { x: leftish ? to.x : to.x + to.w, y: b.y };
  return {
    d: `M ${start.x} ${start.y} C ${side} ${start.y}, ${side} ${end.y}, ${end.x} ${end.y}`,
  };
}

export default function Machine({ status }) {
  const [table, setTable] = useState(null);
  const [wrong, setWrong] = useState(null);
  const [picked, setPicked] = useState(null);
  const [width, setWidth] = useState(0);
  const box = useRef(null);

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

  // The pills are laid out in the page's own pixels, so the edges underneath have
  // to be told how wide the page turned out to be.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const watch = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    watch.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => watch.disconnect();
  }, [table]);

  const here = status?.state || null;
  const took = status?.took || null;

  const plan = useMemo(
    () => (table && width ? layout(table.states, table.edges, width) : null),
    [table, width]
  );

  if (wrong) return <Empty>the machine would not describe itself — {wrong}</Empty>;

  const live = took ? `${took.from}->${took.to}` : null;
  const edges = table?.edges || [];
  const shown = picked
    ? edges.filter((e) => e.from === picked)
    : edges.filter((e) => live === `${e.from}->${e.to}`);
  const told = picked ? table?.states.find((x) => x.name === picked) : null;

  return (
    <div className="machine">
      <div className="machinebox" ref={box} style={{ height: plan ? plan.height : 160 }}>
        {!table && <Empty>reading the machine…</Empty>}
        {plan && (
          <>
            <svg className="mgraph" width={plan.width} height={plan.height} aria-hidden="true">
              <defs>
                <marker id="mhead" viewBox="0 0 10 10" refX="8" refY="5"
                        markerWidth="4" markerHeight="4" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" className="mheadfill" />
                </marker>
                <marker id="mheadlive" viewBox="0 0 10 10" refX="8" refY="5"
                        markerWidth="4.6" markerHeight="4.6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" className="mheadlivefill" />
                </marker>
              </defs>
              {/* svg has no z-index — what is drawn last is drawn on top — so the
                  edge the world is crossing is sorted to the end and nothing can
                  lie over it. */}
              {[...table.edges]
                .map((e) => ({ e, rank: live === `${e.from}->${e.to}` ? 2 : picked === e.from ? 1 : 0 }))
                .sort((a, b) => a.rank - b.rank)
                .map(({ e, rank }) => {
                  const path = wire(plan.place.get(e.from), plan.place.get(e.to), plan.width);
                  if (!path) return null;
                  return (
                    <g key={e.id} className={`medge${rank === 2 ? " live" : ""}${rank === 1 ? " lit" : ""}`}>
                      <path d={path.d} className="mline"
                            markerEnd={rank === 2 ? "url(#mheadlive)" : "url(#mhead)"} />
                      {rank === 2 && <path d={path.d} className="mflow" />}
                    </g>
                  );
                })}
            </svg>

            {table.states.map((s) => {
              const at = plan.place.get(s.name);
              if (!at) return null;
              return (
                <span key={s.name} className="mslot"
                      style={{ left: at.x, top: at.y, width: at.w, height: ROW,
                               fontSize: `${plan.type}px` }}>
                  <Pill
                    className={
                      `mpill r-${s.runs}` +
                      (s.driven === "held" ? " mheld" : "") +
                      (here === s.name ? " mhere" : "")
                    }
                    on={here === s.name || picked === s.name}
                    title={
                      `${s.does}` +
                      `\n\nruns: ${s.runs}` +
                      (s.agents?.length ? `\nasks: ${s.agents.join(", ")}` : "") +
                      (s.driven === "held" ? "\n\nthe loop does not step this one" : "")
                    }
                    onClick={() => setPicked(picked === s.name ? null : s.name)}
                  >
                    {s.name}
                    {!!s.calls && <i className="mcalls">{s.calls}</i>}
                  </Pill>
                </span>
              );
            })}
          </>
        )}
      </div>

      <div className="machineside">
        {told && (
          <>
            <p className="msaid">
              <strong className="mtitle">{told.name}</strong>
              <span className="dim"> — {told.does}</span>
            </p>
            <p className={`masks r-${told.runs}`}>
              {told.agents?.length ? `asks ${told.agents.join(", ")}` : told.runs}
            </p>
          </>
        )}

        {shown.length > 0 && (
          <ul className="medges">
            {shown.map((e) => (
              <li key={e.id} className={live === `${e.from}->${e.to}` ? "live" : ""}>
                <span className="mstep">
                  <strong className="mon">{e.on}</strong>
                  <span className="mgo">{e.from} → {e.to}</span>
                </span>
                <span className="dim mwhen">{e.when}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
