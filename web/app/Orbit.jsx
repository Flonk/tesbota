"use client";

import { useEffect, useMemo, useState } from "react";
import { Cap, Empty, Note, Pill } from "./ui";

/**
 * The system, drawn from the system.
 *
 * Nothing about how long a year is, or where a body stands in its own, is worked
 * out here — `/api/sky` serves what `sky.ts` solved out of the orbit table, at the
 * moment the adventurer is standing in, and this lays it out. An ellipse rather
 * than a circle because the primary sits at a focus, which is what an eccentricity
 * means and the only thing about an orbit you can see by looking.
 */

const SIZE = 1000;
const MIDDLE = SIZE / 2;
const EDGE = 0.88;

const SEASON = {
  midwinter: "midwinter",
  midsummer: "midsummer",
  spring: "the spring equinox",
  autumn: "the autumn equinox",
};

const AU = 1.495978707e11;
const round = (n, to = 2) => Number(n).toFixed(to).replace(/\.?0+$/, "");

function span(metres) {
  if (metres >= AU / 20) return `${round(metres / AU, 3)} AU`;
  if (metres >= 1e9) return `${round(metres / 1e9)} million km`;
  if (metres >= 1000) return `${Math.round(metres / 1000).toLocaleString()} km`;
  return `${Math.round(metres)} m`;
}

const hours = (seconds) => `${round(seconds / 3600, 3)} h`;

/** An orbit as a path, walked the long way round so the eccentricity is honest. */
function ring(body, scale) {
  const { semiMajor: a, eccentricity: e, periapsis } = body;
  const steps = 240;
  const points = [];
  for (let n = 0; n <= steps; n++) {
    const deg = (n / steps) * 360;
    const from = ((deg - periapsis) * Math.PI) / 180;
    const r = (a * (1 - e * e)) / (1 + e * Math.cos(from));
    points.push([
      MIDDLE + r * Math.cos((deg * Math.PI) / 180) * scale,
      MIDDLE - r * Math.sin((deg * Math.PI) / 180) * scale,
    ]);
  }
  return "M " + points.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(" L ") + " Z";
}

const spot = (at, scale) => ({
  x: MIDDLE + at.x * scale,
  y: MIDDLE - at.y * scale,
});

function open(id) {
  window.dispatchEvent(new CustomEvent("bota:open", { detail: id }));
}

export default function Orbit() {
  const [sky, setSky] = useState(null);
  const [picked, setPicked] = useState(null);

  useEffect(() => {
    let live = true;
    fetch("/api/sky", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { error: "the sky could not be read" }))
      .then((s) => live && setSky(s))
      .catch(() => live && setSky({ error: "the sky could not be read" }));
    return () => {
      live = false;
    };
  }, []);

  const plan = useMemo(() => {
    if (!sky?.bodies) return null;
    const all = Object.values(sky.bodies);
    const moving = all.filter((b) => b.at && b.semiMajor);
    if (!moving.length) return { middles: all, moving: [], scale: 1 };
    const widest = Math.max(
      ...moving.map((b) => (b.semiMajor * (1 + b.eccentricity)))
    );
    return {
      middles: all.filter((b) => !b.at || !b.semiMajor),
      moving,
      scale: (MIDDLE * EDGE) / widest,
    };
  }, [sky]);

  if (!sky) return <Empty>solving the sky…</Empty>;
  if (sky.error) return <Note tone="warn">{sky.error}</Note>;
  if (!plan || (!plan.moving.length && !plan.middles.length)) {
    return <Empty>nobody has written the sky down yet</Empty>;
  }

  const home = sky.bodies[sky.home] || null;
  const told = picked ? sky.bodies[picked] : home;
  const marks = home?.seasons || [];

  return (
    <div className="orbit">
      <div className="orbitbox">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="orbitsvg" role="img">
          {plan.moving.map((body) => (
            <path
              key={`ring-${body.id}`}
              d={ring(body, plan.scale)}
              className={`orbitring${picked === body.id ? " on" : ""}`}
            />
          ))}

          {/* Where the tilt turns the year over. They sit on the orbit because
              that is what a season is: a place a world has got to — unnamed here,
              because the list beside this says which is which and says what day
              it falls on as well. */}
          {marks.map((mark) => {
            const body = home;
            const from = ((mark.angle - body.periapsis) * Math.PI) / 180;
            const r =
              (body.semiMajor * (1 - body.eccentricity ** 2)) /
              (1 + body.eccentricity * Math.cos(from));
            const at = spot(
              {
                x: r * Math.cos((mark.angle * Math.PI) / 180),
                y: r * Math.sin((mark.angle * Math.PI) / 180),
              },
              plan.scale
            );
            return (
              <circle
                key={mark.name}
                className={`orbitmark ${mark.name}`}
                cx={at.x}
                cy={at.y}
                r={5}
              >
                <title>{SEASON[mark.name] || mark.name}, day {mark.day}</title>
              </circle>
            );
          })}

          {plan.middles.map((body) => (
            <g
              key={body.id}
              className={`orbitbody middle${picked === body.id ? " on" : ""}`}
              onClick={() => setPicked(picked === body.id ? null : body.id)}
            >
              <circle cx={MIDDLE} cy={MIDDLE} r={14} />
              <text x={MIDDLE} y={MIDDLE + 34} textAnchor="middle">
                {body.name}
              </text>
            </g>
          ))}

          {plan.moving.map((body) => {
            const at = spot(body.at, plan.scale);
            return (
              <g
                key={body.id}
                className={`orbitbody${picked === body.id ? " on" : ""}`}
                onClick={() => setPicked(picked === body.id ? null : body.id)}
              >
                <line x1={MIDDLE} y1={MIDDLE} x2={at.x} y2={at.y} className="orbitreach" />
                <circle cx={at.x} cy={at.y} r={9} />
                <text x={at.x} y={at.y - 18} textAnchor="middle">
                  {body.name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="orbitside">
        {sky.when?.long && <Cap>{sky.when.long}</Cap>}

        {told && (
          <>
            <p className="osaid">
              <strong className="otitle">{told.name}</strong>
              {told.around && (
                <span className="dim"> — goes round {sky.bodies[told.around]?.name || told.around}</span>
              )}
            </p>

            <dl className="ofacts">
              {told.semiMajor != null && (
                <>
                  <dt>orbit</dt>
                  <dd>
                    {span(told.semiMajor)} out
                    {told.eccentricity ? `, eccentricity ${told.eccentricity}` : ", a circle"}
                  </dd>
                </>
              )}
              {told.period != null && (
                <>
                  <dt>year</dt>
                  <dd>
                    {round(told.days_per_year, 3)} of its own days
                    <span className="dim"> — solved, never written down</span>
                  </dd>
                </>
              )}
              {told.rotation != null && (
                <>
                  <dt>turns</dt>
                  <dd>
                    once in {hours(told.rotation)}, and faces its primary again after{" "}
                    {hours(told.solar_day)}
                  </dd>
                </>
              )}
              {told.radius != null && (
                <>
                  <dt>size</dt>
                  <dd>
                    {span(told.radius)} across the equator
                    {told.oblateness ? `, flattened by ${told.oblateness}` : ""}
                  </dd>
                </>
              )}
              {told.mass != null && (
                <>
                  <dt>mass</dt>
                  <dd>{told.mass.toExponential(4)} kg</dd>
                </>
              )}
              {!!told.tilt && (
                <>
                  <dt>leans</dt>
                  <dd>{told.tilt}° — which is what makes the seasons</dd>
                </>
              )}
              {told.subsolar && (
                <>
                  <dt>sun over</dt>
                  <dd>
                    {Math.abs(told.subsolar.lat).toFixed(2)}°
                    {told.subsolar.lat < 0 ? "S" : "N"},{" "}
                    {Math.abs(told.subsolar.lon).toFixed(2)}°
                    {told.subsolar.lon < 0 ? "W" : "E"}
                  </dd>
                </>
              )}
            </dl>

            {!!told.seasons?.length && (
              <ul className="oseasons">
                {told.seasons.map((mark) => (
                  <li key={mark.name}>
                    <span className="omark">{SEASON[mark.name] || mark.name}</span>
                    <span className="dim">day {mark.day} of the year</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="pills">
              <Pill onClick={() => open(told.id)}>read the record</Pill>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
