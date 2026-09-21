"use client";

import { useEffect, useMemo, useState } from "react";
import Globe from "./Globe";
import { Crumb, Empty, Note, openDossier } from "./ui";

/**
 * The system, drawn from the system.
 *
 * Nothing about how long a year is, or where a body stands in its own, is worked
 * out here — `/api/sky` serves what `sky.ts` solved out of the orbit table, at the
 * moment the adventurer is standing in, and this lays it out. An ellipse rather
 * than a circle because the primary sits at a focus, which is what an eccentricity
 * means and the only thing about an orbit you can see by looking.
 *
 * It says where things are and nothing else — no dates, no turns of the year.
 * What a world weighs, how far over it leans and when its solstices fall belong
 * with the world, in its own entry, the way what a place contains does. So
 * tapping a body opens it rather than explaining it here.
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

export default function Orbit({ focus = null }) {
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

  // Something asked for from somewhere else — an entry, most likely. A world is
  // the world being looked at; anything standing on one asks for the world that
  // holds it, and the map goes down to it from there.
  const holder = useMemo(() => {
    if (!focus?.id || !sky?.bodies) return null;
    if (sky.bodies[focus.id]) return focus.id;
    for (const body of Object.values(sky.bodies)) {
      if ((body.standing || []).some((place) => place.id === focus.id)) return body.id;
    }
    return null;
  }, [focus, sky]);

  useEffect(() => {
    if (holder) setPicked(holder);
  }, [holder, focus?.asked]);

  const plan = useMemo(() => {
    if (!sky?.bodies) return null;
    // A system is the space the bodies are in, not a thing sitting in the middle
    // of it. What sits in the middle is whatever everything else goes round.
    const all = Object.values(sky.bodies).filter((b) => b.type !== "celestial-system");
    const moving = all.filter((b) => b.at && b.semiMajor);
    const middles = all.filter((b) => !(b.at && b.semiMajor));
    if (!moving.length) return { middles, moving: [], scale: 1 };
    const widest = Math.max(...moving.map((b) => b.semiMajor * (1 + b.eccentricity)));
    return { middles, moving, scale: (MIDDLE * EDGE) / widest };
  }, [sky]);

  if (!sky) return <Empty>solving the sky…</Empty>;
  if (sky.error) return <Note tone="warn">{sky.error}</Note>;
  if (!plan || (!plan.moving.length && !plan.middles.length)) {
    return <Empty>nobody has written the sky down yet</Empty>;
  }


  const ground = picked ? sky.bodies[picked] : null;

  // The trail is the same bar the places map wears, but its steps are views: the
  // system you can go back to, and the world you are standing over. The one you
  // are already on opens its record instead.
  const trail = [
    sky.system && { id: sky.system.id, name: sky.system.name },
    ground && { id: ground.id, name: ground.name },
  ].filter(Boolean);

  const step = (id) => {
    if (ground && id === ground.id) return openDossier(id);
    if (sky.system && id === sky.system.id) return ground ? setPicked(null) : openDossier(id);
    setPicked(id);
  };

  if (ground?.standing) {
    return (
      <div className="orbit">
        <Crumb className="maptrail" where={trail} onPick={step} />
        <Globe
          body={ground}
          here={sky.here}
          focus={focus?.id === ground.id ? null : focus}
        />
      </div>
    );
  }

  return (
    <div className="orbit">
      <Crumb className="maptrail" where={trail} onPick={step} />
      <div className="orbitpane">
        <div className="orbitbox">
          <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="orbitsvg" role="img">
          {plan.moving.map((body) => (
            <path key={`ring-${body.id}`} d={ring(body, plan.scale)} className="orbitring" />
          ))}

          {plan.middles.map((body) => (
            <g key={body.id} className="orbitbody middle" onClick={() => setPicked(body.id)}>
              <circle cx={MIDDLE} cy={MIDDLE} r={14} />
              <text x={MIDDLE} y={MIDDLE + 36} textAnchor="middle">
                {body.name}
              </text>
            </g>
          ))}

          {plan.moving.map((body) => {
            const at = spot(body.at, plan.scale);
            return (
              <g key={body.id} className="orbitbody" onClick={() => setPicked(body.id)}>
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
      </div>
    </div>
  );
}
