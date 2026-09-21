"use client";

import { useMemo } from "react";
import { openDossier } from "./ui";

/**
 * A world, flattened, with the line between its day and its night drawn on it.
 *
 * Mercator, which cannot draw a pole — it is cut off at 85°, and the dark cap in
 * winter runs off the top or the bottom of the picture rather than closing. That
 * is the trade Mercator makes and it is taken knowingly: the shape of a coast is
 * worth more here than the last five degrees of ice.
 *
 * Nothing is computed about the sky here either. `/api/sky` says where the primary
 * stands over the world and how high it is above every place anybody has fixed;
 * this draws the curve those two things imply.
 */

const W = 1440;
const H = 900;
const LIMIT = 85;
const RAD = Math.PI / 180;

/** Mercator stretches toward the poles without bound, so it is cut at 85°. */
const TALL = Math.log(Math.tan((45 + LIMIT / 2) * RAD));

function down(lat) {
  const held = Math.max(-LIMIT, Math.min(LIMIT, lat));
  return ((1 - Math.log(Math.tan((45 + held / 2) * RAD)) / TALL) / 2) * H;
}

/** Longitude to the left edge. Wrapped, so anything written outside ±180 lands. */
const wrapped = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;
const across = (lon) => ((wrapped(lon) + 180) / 360) * W;

// The terminator is walked from one edge of the picture to the other, so its last
// point has to stay at the right-hand edge rather than wrapping round to the
// left — which folded the night in half and drew it across the map.
const straight = (lon) => ((lon + 180) / 360) * W;

/**
 * The day/night line: for every meridian, the latitude at which the primary sits
 * exactly on the horizon. It is one curve because a sphere lit from one side has
 * one, and the dark half is whichever pole is leaning away.
 */
function night(subsolar) {
  const tilt = Math.tan(subsolar.lat * RAD) || 1e-9;
  const edge = [];
  for (let lon = -180; lon <= 180; lon += 1) {
    const hour = (lon - subsolar.lon) * RAD;
    const lat = Math.atan(-Math.cos(hour) / tilt) / RAD;
    edge.push([straight(lon), down(lat)]);
  }
  const drawn = edge.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L ");
  // The dark half is closed off along whichever edge of the picture is the pole
  // leaning away from the primary. No line is drawn along the curve itself: the sun
  // does not set at an edge, and an edge is what a stroke would draw.
  const pole = subsolar.lat >= 0 ? H : 0;
  return `M ${drawn} L ${W} ${pole} L 0 ${pole} Z`;
}

/**
 * Everything within a few degrees is one mark, because a world map is not the
 * scale at which a village and its mill are different places.
 */
function gather(standing, here) {
  const held = new Map();
  for (const place of standing) {
    const key = `${Math.round(place.lat / 3)}:${Math.round(place.lon / 3)}`;
    if (!held.has(key)) held.set(key, []);
    held.get(key).push(place);
  }
  return [...held.values()].map((all) => {
    const standing_here = all.find((p) => p.id === here);
    const said = standing_here || all[0];
    return {
      id: said.id,
      name: said.name,
      lat: all.reduce((s, p) => s + p.lat, 0) / all.length,
      lon: all.reduce((s, p) => s + p.lon, 0) / all.length,
      day: said.day,
      altitude: said.altitude,
      here: !!standing_here,
      more: all.length - 1,
      all,
    };
  });
}

export default function Globe({ body, here }) {
  const sun = body?.subsolar || null;
  const marks = useMemo(() => gather(body?.standing || [], here), [body, here]);

  if (!sun) return null;

  const dark = night(sun);

  const tropic = Math.abs(body.tilt || 0);
  const lines = [];
  for (let lon = -180; lon <= 180; lon += 30) lines.push({ lon });
  for (let lat = -60; lat <= 60; lat += 30) lines.push({ lat });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="globesvg" role="img">
      <rect x="0" y="0" width={W} height={H} className="globeday" />
      <path d={dark} className="globenight" />

      {lines.map((line, n) =>
        line.lon !== undefined ? (
          <line key={`m${n}`} x1={across(line.lon)} y1="0" x2={across(line.lon)} y2={H}
                className="globegrid" />
        ) : (
          <line key={`p${n}`} x1="0" y1={down(line.lat)} x2={W} y2={down(line.lat)}
                className="globegrid" />
        )
      )}
      <line x1="0" y1={down(0)} x2={W} y2={down(0)} className="globegrid equator" />
      {!!tropic && (
        <>
          <line x1="0" y1={down(tropic)} x2={W} y2={down(tropic)} className="globegrid tropic" />
          <line x1="0" y1={down(-tropic)} x2={W} y2={down(-tropic)} className="globegrid tropic" />
        </>
      )}

      <g className="globesun" transform={`translate(${across(sun.lon)} ${down(sun.lat)})`}>
        <circle r="13" />
        <circle r="24" className="globeglow" />
        <title>the sun stands straight over here</title>
      </g>

      {marks.map((mark) => (
        <g
          key={mark.id}
          className={`globemark${mark.here ? " here" : ""}${mark.day ? " lit" : ""}`}
          transform={`translate(${across(mark.lon)} ${down(mark.lat)})`}
          onClick={() => openDossier(mark.id)}
        >
          <circle r="9" />
          <text y="-20" textAnchor="middle">
            {mark.name}
            {mark.more > 0 ? ` +${mark.more}` : ""}
          </text>
          <title>
            {mark.all.map((p) => p.name).join(", ")} —{" "}
            {mark.day
              ? `the sun stands ${mark.altitude.toFixed(1)}° up`
              : `the sun is ${Math.abs(mark.altitude).toFixed(1)}° down`}
          </title>
        </g>
      ))}
    </svg>
  );
}
