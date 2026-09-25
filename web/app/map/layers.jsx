"use client";

import { useEffect, useMemo, useState } from "react";
import { onto } from "../shaping";
import { isRun } from "../world";
import { grown } from "./editor";
import { labelled } from "./pins";
import {
  across, boxOf, down, H, latOf, lengths, local, lonOf, metresPerPixel, nice, night, offset, pathOf, RAD, W, wrapped,
} from "./projection";

export const LAYER = { region: 1, water: 0, location: 2, road: 3, river: 3 };

const thick = (place, least, perPixel) =>
  place.width && perPixel ? Math.max(least, place.width / perPixel) : undefined;

function Marker({ at, near, children, ...rest }) {
  return (
    <g {...rest} transform={`translate(${at[0]} ${at[1]}) scale(${near})`}>
      {children}
    </g>
  );
}

export function Graticule({ tilt, origin, near }) {
  const meridian = (lon) => {
    const x = across(lon) - origin.x;
    return { className: "globegrid", x1: x, y1: -origin.y, x2: x, y2: H - origin.y };
  };
  const parallel = (lat, className = "globegrid") => {
    const y = down(lat) - origin.y;
    return { className, x1: -origin.x, y1: y, x2: W - origin.x, y2: y };
  };
  const lines = [];
  for (let lon = -180; lon < 180; lon += 30) lines.push(meridian(lon));
  for (let lat = -60; lat <= 60; lat += 30) lines.push(parallel(lat));
  lines.push(parallel(0, "globegrid equator"));
  const tropic = Math.abs(tilt || 0);
  if (tropic) lines.push(parallel(tropic, "globegrid tropic"), parallel(-tropic, "globegrid tropic"));
  return (
    <g style={{ strokeWidth: near }}>
      {lines.map((line, n) => (
        <line key={n} {...line} />
      ))}
    </g>
  );
}

export function Shapes({ drawn, origin, perPixel }) {
  const paths = useMemo(
    () =>
      new Map(
        drawn.map((place) => [
          place.id,
          place.rings.map((ring) => pathOf(offset(ring, origin), place.read.shut)).join(" "),
        ])
      ),
    [drawn, origin]
  );
  return (
    <g>
      {drawn.map((place) => (
        <path
          key={`shape-${place.id}`}
          d={paths.get(place.id)}
          data-place={place.id}
          className={`globeshape ${place.type || "location"}${place.walked ? " walked" : ""}`}
          style={{ "--depth": Math.min(place.depth, 4), strokeWidth: thick(place, 2.5, perPixel) }}
        >
          <title>{place.name}</title>
        </path>
      ))}
      {drawn
        .filter((place) => isRun(place.type))
        .map((place) => (
          <path key={`hit-${place.id}`} d={paths.get(place.id)} data-place={place.id} className="globehit" />
        ))}
    </g>
  );
}

export function Words({ drawn, origin, view, near, perPixel }) {
  // The runs a name can be written along, and the ground it can be written inside:
  // each line put the way it reads, left to right, so no name stands on its head.
  const writable = useMemo(() => {
    const lines = [];
    const waters = [];
    for (const place of drawn) {
      if (isRun(place.type)) {
        let run = offset(place.rings[0], origin);
        if (run.length < 2) continue;
        if (run[0][0] > run[run.length - 1][0]) run = [...run].reverse();
        const upto = lengths(run);
        lines.push({ place, run, upto, long: upto[upto.length - 1], d: pathOf(run) });
      } else if (place.type === "water") {
        const { box } = place;
        const at = place.lat !== null && place.lon !== null
          ? local([place.lon, place.lat], origin)
          : [(box.minX + box.maxX) / 2 - origin.x, (box.minY + box.maxY) / 2 - origin.y];
        waters.push({ place, at, wide: box.maxX - box.minX });
      }
    }
    return { lines, waters };
  }, [drawn, origin]);

  return (
    <g className="globewords">
      {writable.lines.map(({ place, run, upto, long, d }) => {
        const px = thick(place, 0, perPixel) || 0;
        const size = px * 0.62;
        const textLength = size * 0.62 * place.name.length * near;
        if (px < 11 || textLength + size * 2 * near > long) return null;
        const hit = onto(run, [view.x + view.w / 2 - origin.x, view.y + view.h / 2 - origin.y], false);
        const middle = upto[hit.i] + hit.t * (upto[hit.i + 1] - upto[hit.i]);
        const every = Math.max(textLength * 3, 420 * near);
        const spots = [-2, -1, 0, 1, 2]
          .map((n) => middle + n * every)
          .filter((at) => at - textLength / 2 > 0 && at + textLength / 2 < long);
        return (
          <g key={`words-${place.id}`} className={`globeline ${place.type}`}>
            <path id={`words-${place.id}`} d={d} fill="none" stroke="none" />
            {spots.map((at) => (
              <text key={at} style={{ fontSize: size * near }} dy={size * near * 0.34}>
                <textPath href={`#words-${place.id}`} startOffset={at} textAnchor="middle">
                  {place.name}
                </textPath>
              </text>
            ))}
          </g>
        );
      })}
      {writable.waters.map(({ place, at, wide }) =>
        wide / near >= 90 + place.name.length * 7 ? (
          <text
            key={`words-${place.id}`}
            className="globewater"
            x={at[0]}
            y={at[1]}
            textAnchor="middle"
            style={{ fontSize: 13 * near }}
          >
            {place.name}
          </text>
        ) : null
      )}
    </g>
  );
}

export function Ruled({ view, k, radius, origin }) {
  const top = latOf(view.y);
  const bottom = latOf(view.y + view.h);
  const steady = Math.max(-80, Math.min(80, Math.round((top + bottom) / 2 / 5) * 5));
  const round = 2 * Math.PI * radius;
  const length = nice(metresPerPixel(radius, steady, k) * 110);
  const tall = (length / round) * 360;
  const wide = tall / Math.cos(steady * RAD);
  const west = Math.max(lonOf(view.x), -180);
  const east = Math.min(lonOf(view.x + view.w), 180);
  const xs = [];
  const ys = [];
  for (let lon = Math.ceil(west / wide) * wide; lon <= east && xs.length < 400; lon += wide) xs.push(across(lon));
  for (let lat = Math.floor(bottom / tall) * tall; lat <= top && ys.length < 400; lat += tall) ys.push(down(lat));
  return (
    <g className="globeruled">
      {xs.map((x) => (
        <line key={`gx${x}`} x1={x - origin.x} y1={view.y - origin.y} x2={x - origin.x} y2={view.y + view.h - origin.y} />
      ))}
      {ys.map((y) => (
        <line key={`gy${y}`} x1={view.x - origin.x} y1={y - origin.y} x2={view.x + view.w - origin.x} y2={y - origin.y} />
      ))}
    </g>
  );
}

export function Night({ sun, origin }) {
  const d = useMemo(() => night(sun, origin), [sun, origin]);
  return <path d={d} className="globenight" />;
}

export function Sun({ sun, origin, near }) {
  return (
    <Marker className="globesun" at={local([sun.lon, sun.lat], origin)} near={near}>
      <circle r="7" />
      <circle r="13" className="globeglow" />
      <title>subsolar point</title>
    </Marker>
  );
}

export function Moons({ sun, overhead, origin, near }) {
  return overhead.map((other) => {
    const dx = wrapped(sun.lon - other.lon);
    const dy = other.lat - sun.lat;
    const far = Math.hypot(dx, dy) || 1;
    const lit = { x: 0.5 + (0.32 * dx) / far, y: 0.5 + (0.32 * dy) / far };
    return (
      <Marker key={`over-${other.id}`} className="globemoon" at={local([other.lon, other.lat], origin)} near={near}>
        <defs>
          <radialGradient id={`lit-${other.id}`} cx={lit.x} cy={lit.y} fx={lit.x} fy={lit.y} r="0.75">
            <stop offset="0" className="moonlit" />
            <stop offset="0.55" className="moonmid" />
            <stop offset="1" className="moondark" />
          </radialGradient>
        </defs>
        <circle r="6.5" fill={`url(#lit-${other.id})`} />
        <title>{`${other.name} is overhead here`}</title>
      </Marker>
    );
  });
}

export function Draft({ draft, origin, perPixel }) {
  const traced = (run) => pathOf(run.map((point) => local(point, origin)), draft.shut);
  return (
    <g className="globedraft">
      {draft.runs.map((run, r) => (
        <path
          key={`draft-${r}`}
          data-draft=""
          className={`globeshape ${draft.shut ? "location" : "road"} drafting`}
          style={{ strokeWidth: draft.shut ? undefined : thick(draft, 2, perPixel) }}
          fillRule="evenodd"
          d={traced(run)}
        />
      ))}
      {!draft.shut && draft.runs.map((run, r) => (
        <path key={`draft-hit-${r}`} data-draft="" className="globehit" d={traced(run)} />
      ))}
    </g>
  );
}

export function Trip({ journey, walker, origin, near }) {
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    if (!journey?.path?.length) return;
    const beat = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(beat);
  }, [journey]);

  // A journey under way: the road behind, the road ahead, and how far along it
  // they are by now — worked out from when they set out and when they will stop.
  const trip = (() => {
    if (!journey?.path || journey.path.length < 2) return null;
    const pts = journey.path.map((point) => local(point, origin));
    const upto = lengths(pts);
    const long = upto[upto.length - 1];
    const from = Date.parse(journey.from);
    const until = Date.parse(journey.until);
    const done = until > from ? Math.max(0, Math.min(1, (clock - from) / (until - from))) : 1;
    const want = long * done * (journey.reach ?? 1);
    let n = 1;
    while (n < pts.length - 1 && upto[n] < want) n++;
    const t = upto[n] > upto[n - 1] ? (want - upto[n - 1]) / (upto[n] - upto[n - 1]) : 0;
    const at = [pts[n - 1][0] + (pts[n][0] - pts[n - 1][0]) * t, pts[n - 1][1] + (pts[n][1] - pts[n - 1][1]) * t];
    return {
      behind: pathOf([...pts.slice(0, n), at]),
      ahead: pathOf([at, ...pts.slice(n)]),
      at,
    };
  })();

  if (!trip && !walker) return null;
  return (
    <>
      {trip && (
        <g className="globetrip">
          <path className="behind" d={trip.behind} style={{ strokeWidth: 3 * near, strokeDasharray: `0 ${9 * near}` }} />
          <path
            className="ahead"
            d={trip.ahead}
            style={{ strokeWidth: 5 * near, strokeDasharray: `0 ${14 * near}`, "--march": `${-28 * near}` }}
          />
        </g>
      )}
      <Marker className="globewalker" at={trip ? trip.at : local([walker.lon, walker.lat], origin)} near={near}>
        <circle r="11" className="globehalo" />
        <circle r="4.5" />
        <title>you are here</title>
      </Marker>
    </>
  );
}

export function Pins({ marks, chosen, origin, near }) {
  const named = labelled(marks, near);
  return marks.map((mark) => (
    <Marker
      key={mark.id}
      data-place={mark.id}
      className={`globemark${mark.here ? " here" : ""}${mark.day ? " lit" : ""}${mark.id === chosen ? " chosen" : ""}`}
      at={local([mark.lon, mark.lat], origin)}
      near={near}
    >
      <circle r="5" />
      {named.has(mark.id) && (
        <text y="-11" textAnchor="middle">
          {mark.name}
        </text>
      )}
      <title>
        {mark.all.map((p) => p.name).join(", ")}
        {mark.altitude === null
          ? ""
          : mark.day
            ? ` — the sun stands ${mark.altitude.toFixed(1)}° up`
            : ` — the sun is ${Math.abs(mark.altitude).toFixed(1)}° down`}
      </title>
    </Marker>
  ));
}

export function Handles({ draft, tool, picked, coarse, origin, near }) {
  const handles = tool === "corners" || tool === "erase";
  return (
    <g className="globedraft">
      {tool === "corners" && draft.runs.map((run, r) =>
        run.map((point, n) => {
          const next = run[(n + 1) % run.length];
          if (run.length < 2 || (!draft.shut && n === run.length - 1)) return null;
          const [x, y] = local([(point[0] + next[0]) / 2, (point[1] + next[1]) / 2], origin);
          return (
            <circle
              key={`ghost-${r}-${n}`}
              className="globeghost"
              data-ghost={`${r}:${n}`}
              cx={x}
              cy={y}
              r={(coarse ? 8 : 4) * near}
            />
          );
        })
      )}

      {tool === "corners" && !draft.shut && draft.runs.map((run, r) =>
        run.length >= 2 && ["start", "end"].map((end) => {
          const [x, y] = local(grown(run, end, near)[1], origin);
          return (
            <g key={`tip-${r}-${end}`} className="globetip">
              <circle
                className="globeghost"
                data-ghost={`${r}:${end}`}
                cx={x}
                cy={y}
                r={(coarse ? 9 : 6) * near}
              />
              <path
                d={`M ${x - 3 * near} ${y} h ${6 * near} M ${x} ${y - 3 * near} v ${6 * near}`}
                style={{ strokeWidth: 1.3 * near }}
              />
            </g>
          );
        })
      )}

      {draft.runs.map((run, r) =>
        run.map((point, n) => {
          const [x, y] = local(point, origin);
          return (
            <circle
              key={`corner-${r}-${n}`}
              className={`globecorner${tool === "erase" ? " cutting" : ""}${
                handles ? "" : " passive"
              }${picked && picked.run === r && picked.at === n ? " picked" : ""}`}
              data-corner={handles ? `${r}:${n}` : undefined}
              cx={x}
              cy={y}
              r={(handles ? (coarse ? 10 : 6) : 3) * near}
            />
          );
        })
      )}
    </g>
  );
}

const GRIPS = [["nw", 0, 0], ["n", 1, 0], ["ne", 2, 0], ["e", 2, 1], ["se", 2, 2], ["s", 1, 2], ["sw", 0, 2], ["w", 0, 1]];

export function Gizmo({ draft, coarse, origin, near }) {
  const box = boxOf(draft.runs.flat().map((point) => local(point, origin)));
  if (!box) return null;
  const pad = 8 * near;
  const band = (coarse ? 36 : 24) * near;
  const size = (coarse ? 14 : 8) * near;
  const xs = [box.minX - pad, (box.minX + box.maxX) / 2, box.maxX + pad];
  const ys = [box.minY - pad, (box.minY + box.maxY) / 2, box.maxY + pad];
  const frame = (grow) =>
    `M ${xs[0] - grow} ${ys[0] - grow} H ${xs[2] + grow} V ${ys[2] + grow} H ${xs[0] - grow} Z`;
  return (
    <g className="globegizmo">
      <path className="gizmospin" data-grip="spin" d={`${frame(band)} ${frame(0)}`} />
      <path className="gizmoframe" data-draft="" d={frame(0)} />
      {GRIPS.map(([grip, i, j]) => (
        <rect
          key={grip}
          className={`gizmogrip ${grip}`}
          data-grip={grip}
          x={xs[i] - size / 2}
          y={ys[j] - size / 2}
          width={size}
          height={size}
        />
      ))}
    </g>
  );
}

export function Stroke({ pen, origin, near }) {
  return (
    <path
      className="globepen"
      style={{ strokeWidth: 2 * near }}
      d={pathOf(pen.map((point) => local(point, origin)))}
    />
  );
}

export function Scale({ perPixel }) {
  const length = nice(perPixel * 110);
  return (
    <div className="globeruler" aria-hidden="true">
      <span>{length >= 1000 ? `${(length / 1000).toLocaleString()} km` : `${length} m`}</span>
      <i style={{ width: `${length / perPixel}px` }} />
    </div>
  );
}
