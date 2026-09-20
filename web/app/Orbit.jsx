"use client";

import { useEffect, useMemo, useState } from "react";
import { Cap, Empty, Note, openDossier } from "./ui";

/**
 * The system, drawn from the system.
 *
 * Nothing about how long a year is, or where a body stands in its own, is worked
 * out here — `/api/sky` serves what `sky.ts` solved out of the orbit table, at the
 * moment the adventurer is standing in, and this lays it out. An ellipse rather
 * than a circle because the primary sits at a focus, which is what an eccentricity
 * means and the only thing about an orbit you can see by looking.
 *
 * It says where things are and nothing else. What a world weighs and how far over
 * it leans belong with the world, in its own entry, the way what a place contains
 * does — so tapping a body opens it rather than explaining it here.
 */

const SIZE = 1000;
const MIDDLE = SIZE / 2;
const EDGE = 0.88;

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

const spot = (at, scale) => ({ x: MIDDLE + at.x * scale, y: MIDDLE - at.y * scale });

export default function Orbit() {
  const [sky, setSky] = useState(null);

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
    const middles = all.filter((b) => !b.at || !b.semiMajor);
    if (!moving.length) return { middles, moving: [], scale: 1 };
    const widest = Math.max(...moving.map((b) => b.semiMajor * (1 + b.eccentricity)));
    return { middles, moving, scale: (MIDDLE * EDGE) / widest };
  }, [sky]);

  if (!sky) return <Empty>solving the sky…</Empty>;
  if (sky.error) return <Note tone="warn">{sky.error}</Note>;
  if (!plan || (!plan.moving.length && !plan.middles.length)) {
    return <Empty>nobody has written the sky down yet</Empty>;
  }

  const marks = (sky.bodies[sky.home] || {}).seasons || [];
  const home = sky.bodies[sky.home];

  return (
    <div className="orbit">
      <div className="orbitbox">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="orbitsvg" role="img">
          {plan.moving.map((body) => (
            <path key={`ring-${body.id}`} d={ring(body, plan.scale)} className="orbitring" />
          ))}

          {/* Where the tilt turns the year over. They sit on the orbit because that
              is what a season is: a place a world has got to. */}
          {marks.map((mark) => {
            const from = ((mark.angle - home.periapsis) * Math.PI) / 180;
            const r =
              (home.semiMajor * (1 - home.eccentricity ** 2)) /
              (1 + home.eccentricity * Math.cos(from));
            const at = spot(
              {
                x: r * Math.cos((mark.angle * Math.PI) / 180),
                y: r * Math.sin((mark.angle * Math.PI) / 180),
              },
              plan.scale
            );
            return (
              <circle key={mark.name} className={`orbitmark ${mark.name}`} cx={at.x} cy={at.y} r={5}>
                <title>
                  {mark.name}, day {mark.day}
                </title>
              </circle>
            );
          })}

          {plan.middles.map((body) => (
            <g key={body.id} className="orbitbody middle" onClick={() => openDossier(body.id)}>
              <circle cx={MIDDLE} cy={MIDDLE} r={14} />
              <text x={MIDDLE} y={MIDDLE + 36} textAnchor="middle">
                {body.name}
              </text>
            </g>
          ))}

          {plan.moving.map((body) => {
            const at = spot(body.at, plan.scale);
            return (
              <g key={body.id} className="orbitbody" onClick={() => openDossier(body.id)}>
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

      {sky.when?.long && <Cap>{sky.when.long}</Cap>}
    </div>
  );
}
