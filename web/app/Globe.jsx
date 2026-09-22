"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openDossier } from "./ui";
import { added, dropped, extentOf, moved, opened, reshape, runsOf, straighten } from "./shaping";
import { Tabs } from "./ui";

/**
 * A world, flattened, with the line between its day and its night drawn on it.
 *
 * Mercator, which cannot draw a pole — it is cut off at 85°, and the dark cap in
 * winter runs off the top or the bottom of the picture rather than closing. That
 * is the trade Mercator makes and it is taken knowingly: the shape of a coast is
 * worth more here than the last five degrees of ice.
 *
 * Nothing is computed about the sky here. `/api/sky` says where the primary stands
 * over the world and how high it is above every place anybody has fixed; this
 * draws the curve those two things imply, and lets you get closer to it.
 */

const W = 1440;
const H = 900;
const LIMIT = 85;
const RAD = Math.PI / 180;
// A village street is nine hundred metres on a world six thousand kilometres
// across, and a mill on it is eighteen. Coming close enough for a building to be
// the thing you are looking at is six figures of zoom, not two.
const CLOSEST = 250000;

/**
 * How much of the picture a place has to fill before the map will say that is
 * what you are looking at. Below this it is ground you happen to be over rather
 * than somewhere you came to see.
 */
const ENOUGH = 0.15;

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

const hold = (n, low, high) => Math.max(low, Math.min(high, n));

// The projection read backwards. Looking at a map never needs this; putting a
// finger on one and saying "there" does.
const lonOf = (x) => wrapped((x / W) * 360 - 180);
const latOf = (y) => 2 * (Math.atan(Math.exp(TALL * (1 - (2 * y) / H))) / RAD - 45);

/** Whether a drawn shape covers a point — even-odd, over every ring it has. */
function holds(d, x, y) {
  let inside = false;
  for (const run of d.split("M ").slice(1)) {
    const numbers = run.match(/-?\d+(?:\.\d+)?/g);
    if (!numbers) continue;
    const ring = [];
    for (let n = 0; n + 1 < numbers.length; n += 2) ring.push([+numbers[n], +numbers[n + 1]]);
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** What a drawn path takes up, read back off the path itself. */
function bounds(d) {
  const numbers = d.match(/-?\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length < 2) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let n = 0; n + 1 < numbers.length; n += 2) {
    const x = Number(numbers[n]);
    const y = Number(numbers[n + 1]);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY };
}

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
 * A shape, in the picture's own units. Roads and rivers are runs and are drawn as
 * one; everything else has ground and is drawn closed.
 */
function outline(extent) {
  let drawn;
  try {
    drawn = JSON.parse(extent);
  } catch {
    return null;
  }
  const runs = [];
  const walk = (node) => {
    if (!Array.isArray(node)) return;
    if (node.length && Array.isArray(node[0]) && typeof node[0][0] === "number") runs.push(node);
    else node.forEach(walk);
  };
  walk(drawn.coordinates);
  if (!runs.length) return null;
  const shut = drawn.type === "Polygon" || drawn.type === "MultiPolygon";
  return runs
    .map(
      (run) =>
        "M " +
        run.map(([lon, lat]) => `${across(lon).toFixed(5)} ${down(lat).toFixed(5)}`).join(" L ") +
        (shut ? " Z" : "")
    )
    .join(" ");
}

/**
 * Everything within a few degrees is one mark. How few depends on how close you
 * are: a village and its mill are the same place on a world map and different ones
 * once you have come down to them.
 */
function gather(standing, here, span) {
  const cell = 3 * span;
  const held = new Map();
  for (const place of standing) {
    if (place.lat === null || place.lon === null) continue;
    const key = `${Math.round(place.lat / cell)}:${Math.round(place.lon / cell)}`;
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

const FIT = { x: 0, y: 0, w: W, h: H };

export default function Globe({
  body,
  here,
  focus = null,
  onCentre = null,
  editing = false,
  onSaved = null,
}) {
  const [view, setView] = useState(FIT);
  const [pane, setPane] = useState({ w: 0, h: 0 });
  // What is being reshaped, and the shape as it stands before it is written down.
  const [chosen, setChosen] = useState(null);
  const [draft, setDraft] = useState(null);
  const [tool, setTool] = useState("pick");
  const [pen, setPen] = useState(null);
  const [saving, setSaving] = useState(false);
  const [wrong, setWrong] = useState(null);
  const [shifted, setMoved] = useState(null);
  const dragging = useRef(null);
  // A corner taken away is gone by the time the click lands, so the click lands on
  // whatever was underneath it — which was reading as "take that up instead".
  const swallow = useRef(false);
  // How far the whole shape has been carried, and whether what stood on it comes.
  const [carry, setCarry] = useState(null);
  const [bringing, setBringing] = useState(true);
  const shoving = useRef(null);
  const svg = useRef(null);
  const grab = useRef(null);
  const held = useRef(FIT);
  const touches = useRef({ at: {}, span: 0 });

  useEffect(() => {
    held.current = view;
  }, [view]);

  // A fresh world starts whole again.
  useEffect(() => {
    setView(FIT);
  }, [body?.id]);

  useEffect(() => {
    setChosen(null);
    setDraft(null);
    setPen(null);
    setCarry(null);
    setTool("pick");
    setWrong(null);
  }, [editing, body?.id]);

  // How big the picture is on the screen, which is what a pin has to be measured
  // against. Against the map, a pin would be three pixels across on a phone.
  useEffect(() => {
    const el = svg.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(([entry]) =>
      setPane({ w: entry.contentRect.width, h: entry.contentRect.height })
    );
    watch.observe(el);
    const box = el.getBoundingClientRect();
    setPane({ w: box.width, h: box.height });
    return () => watch.disconnect();
  }, [body?.id]);

  const sun = body?.subsolar || null;
  const marks = useMemo(
    () => gather(body?.standing || [], here, view.w / W),
    [body, here, view.w]
  );

  // Ground first, then what runs across it, then what stands on it — so a house
  // is not painted over by the village holding it.
  const drawn = useMemo(() => {
    const order = { region: 0, road: 1, river: 1 };
    return (body?.standing || [])
      .filter((place) => place.extent && place.id !== chosen)
      .map((place) => ({ ...place, d: outline(place.extent) }))
      .filter((place) => place.d)
      .sort((a, b) => (order[a.type] ?? 2) - (order[b.type] ?? 2));
  }, [body, chosen]);
  const dark = useMemo(() => (sun ? night(sun) : null), [sun]);

  /**
   * What the middle of the picture is standing on: the smallest written shape that
   * both covers it and is big enough on the screen to be the thing you are looking
   * at. Roads and rivers are runs rather than ground, so you are never on one.
   */
  const centred = useMemo(() => {
    const x = view.x + view.w / 2;
    const y = view.y + view.h / 2;
    let best = null;
    for (const place of drawn) {
      if (place.type === "road" || place.type === "river") continue;
      const box = bounds(place.d);
      if (!box) continue;
      const fills = Math.max(
        (box.maxX - box.minX) / view.w,
        (box.maxY - box.minY) / view.h
      );
      if (fills < ENOUGH) continue;
      if (!holds(place.d, x, y)) continue;
      const size = (box.maxX - box.minX) * (box.maxY - box.minY);
      if (!best || size < best.size) best = { id: place.id, size };
    }
    return best?.id ?? null;
  }, [drawn, view]);

  useEffect(() => {
    if (onCentre) onCentre(centred);
  }, [centred, onCentre]);

  // Where the adventurer is standing, which is the one thing on this map that is
  // not a place.
  const walker = useMemo(() => {
    const at = (body?.standing || []).find((p) => p.id === here);
    return at && at.lat !== null && at.lon !== null ? at : null;
  }, [body, here]);

  /**
   * Where the picture actually sits on the screen, so a finger can be put on it.
   * The world covers its pane rather than sitting letterboxed inside it, so the
   * scale is whichever of the two is larger and the overflow is simply cropped.
   */
  const framed = useCallback(() => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return null;
    const now = held.current;
    const k = Math.max(box.width / now.w, box.height / now.h);
    return {
      k,
      ox: box.left + (box.width - now.w * k) / 2,
      oy: box.top + (box.height - now.h * k) / 2,
    };
  }, []);

  /**
   * Keep the world in the window: you may come closer, never sail off the edge.
   *
   * What has to stay on the map is the part you can actually see, which is smaller
   * than the box being asked for — covering a pane crops it. So the middle is what
   * is held, half a screen in from either side.
   */
  const settle = useCallback((want) => {
    const w = hold(want.w, W / CLOSEST, W);
    const h = (w * H) / W;
    const box = svg.current?.getBoundingClientRect();
    if (!box?.width || !box?.height) {
      return { w, h, x: hold(want.x, 0, W - w), y: hold(want.y, 0, H - h) };
    }
    const k = Math.max(box.width / w, box.height / h);
    const seen = { w: box.width / k, h: box.height / k };
    const cx = hold(want.x + w / 2, seen.w / 2, W - seen.w / 2);
    const cy = hold(want.y + h / 2, seen.h / 2, H - seen.h / 2);
    return { w, h, x: cx - w / 2, y: cy - h / 2 };
  }, []);

/** Put a shape in the window, with room around it. */
  const frame = useCallback((place) => {
    const d = place.extent && outline(place.extent);
    const box = d ? bounds(d) : null;
    const wide = box ? Math.max(box.maxX - box.minX, (box.maxY - box.minY) * (W / H)) * 3 : W / 400;
    const x = box ? (box.minX + box.maxX) / 2 : across(place.lon);
    const y = box ? (box.minY + box.maxY) / 2 : down(place.lat);
    const w = hold(wide, W / CLOSEST, W);
    return { x: x - w / 2, y: y - (w * H) / W / 2, w, h: (w * H) / W };
  }, []);

  // Asked for from outside: come down to it.
  useEffect(() => {
    if (!focus?.id) return;
    const place = (body?.standing || []).find((p) => p.id === focus.id);
    if (!place || (place.lat === null && !place.extent)) return;
    setView(settle(frame(place)));
  }, [focus?.id, focus?.asked, body, frame, settle]);

  const zoomAt = useCallback(
    (clientX, clientY, factor) => {
      const f = framed();
      if (!f) return;
      setView((now) => {
        const px = now.x + (clientX - f.ox) / f.k;
        const py = now.y + (clientY - f.oy) / f.k;
        const w = hold(now.w * factor, W / CLOSEST, W);
        const step = w / now.w;
        return settle({ x: px - (px - now.x) * step, y: py - (py - now.y) * step, w, h: now.h * step });
      });
    },
    [framed, settle]
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

  /** Where a finger is on the world, rather than on the screen. */
  const degrees = useCallback(
    (clientX, clientY) => {
      const f = framed();
      if (!f) return null;
      const now = held.current;
      return [
        lonOf(now.x + (clientX - f.ox) / f.k),
        latOf(now.y + (clientY - f.oy) / f.k),
      ];
    },
    [framed]
  );

  /** Take up a shape to work on, as it is written. */
  const take = useCallback((place) => {
    const read = place.extent ? runsOf(place.extent) : null;
    setChosen(place.id);
    setDraft(read || { shut: place.type !== "road" && place.type !== "river", runs: [[]] });
    setCarry(null);
    setWrong(null);
  }, []);

  const alter = useCallback((run, at, how) => {
    setDraft((now) => {
      if (!now) return now;
      const runs = now.runs.map((r, n) => (n === run ? how(r) : r));
      return { ...now, runs };
    });
  }, []);

  async function keep() {
    if (!chosen || !draft) return;
    const extent = extentOf(draft);
    if (!extent) return setWrong("there is not enough of a shape there to write down");
    setSaving(true);
    setWrong(null);
    try {
      const res = await fetch("/api/shape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: chosen, extent, carry: bringing ? carry : null }),
      });
      const back = await res.json().catch(() => null);
      if (back?.error) setWrong(back.error);
      else {
        // Whatever the new shape now holds, or has let go of, it says so.
        const carried = back?.carried || [];
        const shifted = [...carried.map((id) => ({ id })), ...(back?.moved || [])];
        setMoved(shifted.length ? shifted : null);
        // Asking for the subplaces and getting none is worth saying: it means
        // nothing was standing on that ground, not that the asking was ignored.
        if (!carried.length && bringing && carry) {
          setWrong("nothing was standing inside it, so nothing came along");
        }
        setChosen(null);
        setDraft(null);
        setCarry(null);
        if (onSaved) onSaved();
      }
    } catch (err) {
      setWrong(String(err));
    } finally {
      setSaving(false);
    }
  }

  function seat(x, y, moved) {
    grab.current = { from: { ...held.current }, x, y, moved };
  }

  function press(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);

    // A corner under the finger is what the finger has hold of, not the map.
    if (editing && e.target?.classList?.contains("globeghost")) return;
    const corner = e.target?.closest?.("[data-corner]");
    if (editing && corner) {
      const [run, at] = corner.dataset.corner.split(":").map(Number);
      if (tool === "erase") {
        e.stopPropagation();
        swallow.current = true;
        alter(run, at, (held) => (held.length > 3 ? dropped(held, at) : held));
        return;
      }
      dragging.current = { run, at, moved: false };
      return;
    }
    if (editing && tool === "shove" && draft) {
      const point = degrees(e.clientX, e.clientY);
      if (point) shoving.current = { from: point, runs: draft.runs };
      return;
    }
    if (editing && tool === "draw" && chosen) {
      const point = degrees(e.clientX, e.clientY);
      if (point) setPen([point]);
      return;
    }

    touches.current.at[e.pointerId] = { x: e.clientX, y: e.clientY };
    const on = Object.keys(touches.current.at).length;
    if (on === 1) seat(e.clientX, e.clientY, false);
    if (on >= 2) {
      grab.current = null;
      touches.current.span = 0;
      touches.current.pinched = true;
    }
  }

  function move(e) {
    const held_corner = dragging.current;
    if (held_corner) {
      const point = degrees(e.clientX, e.clientY);
      if (!point) return;
      held_corner.moved = true;
      alter(held_corner.run, held_corner.at, (run) => moved(run, held_corner.at, point));
      return;
    }
    const shove = shoving.current;
    if (shove) {
      const point = degrees(e.clientX, e.clientY);
      if (!point) return;
      const by = { lon: point[0] - shove.from[0], lat: point[1] - shove.from[1] };
      setDraft((now) =>
        now && { ...now, runs: shove.runs.map((run) => run.map(([x, y]) => [x + by.lon, y + by.lat])) }
      );
      shove.by = by;
      return;
    }
    if (pen) {
      const point = degrees(e.clientX, e.clientY);
      if (point) setPen((run) => [...run, point]);
      return;
    }

    const finger = touches.current.at[e.pointerId];
    if (!finger) return;
    finger.x = e.clientX;
    finger.y = e.clientY;

    const on = Object.values(touches.current.at);
    if (on.length >= 2) {
      const [one, two] = on;
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
    setView(settle({ ...g.from, x: g.from.x - dx / f.k, y: g.from.y - dy / f.k }));
  }

  function lift(e) {
    if (shoving.current) {
      const by = shoving.current.by;
      shoving.current = null;
      if (by && (by.lon || by.lat)) {
        setCarry((was) => ({ lon: (was?.lon || 0) + by.lon, lat: (was?.lat || 0) + by.lat }));
      }
      return;
    }
    if (dragging.current) {
      dragging.current = null;
      return;
    }
    if (pen) {
      // What the hand did, thinned to the corners that carry it — and worked into
      // the shape that is already there rather than put in its place.
      const room = ((view.w / Math.max(1, pane.w)) / W) * 360 * 3;
      setPen(null);
      // Degrees to a pixel, which is what a hand's wobble is worth here.
      const ring = draft?.shut && draft.runs[0] ? opened(draft.runs[0]) : null;
      if (ring && ring.length >= 3) {
        // A stroke over a shape alters it or does nothing. It never stands in for
        // it: one ambiguous scribble should not throw a drawn boundary away.
        const altered = reshape(draft.runs[0], pen, room);
        if (altered) setDraft({ shut: true, runs: [altered] });
        else setWrong("that stroke did not say where it met the shape");
        return;
      }
      const said = straighten(pen, room, draft?.shut ?? null);
      if (said) setDraft({ shut: said.shut, runs: [said.points] });
      return;
    }
    delete touches.current.at[e.pointerId];
    const left = Object.values(touches.current.at);
    touches.current.span = 0;
    if (left.length === 1) seat(left[0].x, left[0].y, true);
    else if (!left.length) touches.current.pinched = false;
  }

  function tap(id) {
    if (swallow.current) {
      swallow.current = false;
      return;
    }
    if (grab.current?.moved || touches.current.pinched) return;
    if (!editing) return openDossier(id);
    // Tapping what is already in hand would start it again and lose the corners
    // moved, the ground carried, all of it.
    if (id === chosen) return;
    const place = (body?.standing || []).find((p) => p.id === id);
    if (place) take(place);
  }

  if (!sun) return null;

  // Everything drawn on top of the world is kept the same size on the screen
  // however close you are, the way a pin does not grow when a map is zoomed. One
  // user unit at this scale is one pixel, so the numbers below are pixels — and
  // because the world covers its pane, the scale comes from whichever side of it
  // is doing the covering.
  const near =
    pane.w && pane.h
      ? Math.min(view.w / pane.w, view.h / pane.h)
      : view.w / W;

  // Two names on top of each other say less than one name does. Whoever you are
  // standing with wins, then whoever stands with the most.
  const said = [];
  for (const mark of [...marks].sort(
    (a, b) => (b.here ? 1 : 0) - (a.here ? 1 : 0) || b.all.length - a.all.length
  )) {
    const x = across(mark.lon);
    const y = down(mark.lat);
    const crowded = said.some(
      (kept) => Math.abs(kept.x - x) < 90 * near && Math.abs(kept.y - y) < 26 * near
    );
    if (!crowded) said.push({ id: mark.id, x, y });
  }
  const named = new Set(said.map((k) => k.id));
  const tropic = Math.abs(body.tilt || 0);
  const lines = [];
  for (let lon = -180; lon < 180; lon += 30) lines.push({ lon });
  for (let lat = -60; lat <= 60; lat += 30) lines.push({ lat });

  const taken = chosen && (body.standing || []).find((p) => p.id === chosen);

  return (
    <>
    {editing && (
      <Tabs
        className="sub tools"
        value={tool}
        onChange={setTool}
        items={[
          { id: "pick", label: "corners", icon: "pin" },
          { id: "draw", label: "draw", icon: "pen" },
          { id: "shove", label: "move", icon: "map" },
          { id: "erase", label: "erase", icon: "silence" },
        ]}
      />
    )}

    {editing && (
      <div className="shapebar">
        {taken ? (
          <>
            <span className="gname">{taken.name}</span>
            {tool === "shove" && (
              <button
                className={`gtool${bringing ? " on" : ""}`}
                onClick={() => setBringing((was) => !was)}
                title="move everything standing on this ground along with it"
              >
                include subplaces
              </button>
            )}
            <button className="gtool" onClick={() => take(taken)} disabled={saving}>
              revert
            </button>
            <button className="gtool keep" onClick={keep} disabled={saving}>
              {saving ? "…" : "save"}
            </button>
          </>
        ) : (
          <span className="gname dim">tap a shape to take it up</span>
        )}
      </div>
    )}

    <svg
      ref={svg}
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      className="globesvg"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      onPointerDown={press}
      onPointerMove={move}
      onPointerUp={lift}
      onPointerCancel={lift}
    >
      <rect x="0" y="0" width={W} height={H} className="globeday" />
      <path d={dark} className="globenight" />

      <g style={{ strokeWidth: near }}>
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
      </g>

      <g style={{ strokeWidth: near }}>
        {drawn.map((place) => (
          <path
            key={`shape-${place.id}`}
            d={place.d}
            className={`globeshape ${place.type || "location"}${place.walked ? " walked" : ""}`}
            onClick={() => tap(place.id)}
          >
            <title>{place.name}</title>
          </path>
        ))}
      </g>

      <g className="globesun" transform={`translate(${across(sun.lon)} ${down(sun.lat)}) scale(${near})`}>
        <circle r="7" />
        <circle r="13" className="globeglow" />
        <title>the sun stands straight over here</title>
      </g>

      {walker && (
        <g
          className="globewalker"
          transform={`translate(${across(walker.lon)} ${down(walker.lat)}) scale(${near})`}
        >
          <circle r="11" className="globehalo" />
          <circle r="4.5" />
          <title>you are here</title>
        </g>
      )}

      {marks.map((mark) => (
        <g
          key={mark.id}
          className={`globemark${mark.here ? " here" : ""}${mark.day ? " lit" : ""}`}
          transform={`translate(${across(mark.lon)} ${down(mark.lat)}) scale(${near})`}
          onClick={() => tap(mark.id)}
        >
          <circle r="5" />
          {named.has(mark.id) && (
            <text y="-11" textAnchor="middle">
              {mark.name}
              {mark.more > 0 ? ` +${mark.more}` : ""}
            </text>
          )}
          <title>
            {mark.all.map((p) => p.name).join(", ")} —{" "}
            {mark.day
              ? `the sun stands ${mark.altitude.toFixed(1)}° up`
              : `the sun is ${Math.abs(mark.altitude).toFixed(1)}° down`}
          </title>
        </g>
      ))}

      {/* Last, so a corner is never hidden under the name of something else —
          a label that swallows the handle you are reaching for is a handle that
          does not work. */}
      {draft && (
        <g className="globedraft">
          {draft.runs.map((run, r) => (
            <path
              key={`draft-${r}`}
              className={`globeshape ${draft.shut ? "location" : "road"} drafting`}
              d={
                run.length
                  ? "M " +
                    run.map(([lon, lat]) => `${across(lon)} ${down(lat)}`).join(" L ") +
                    (draft.shut ? " Z" : "")
                  : ""
              }
            />
          ))}

          {/* A ghost between every pair of corners: press one and it becomes a
              corner of its own. */}
          {draft.runs.map((run, r) =>
            run.map((point, n) => {
              const next = run[(n + 1) % run.length];
              if (!next || (!draft.shut && n === run.length - 1)) return null;
              const mid = [(point[0] + next[0]) / 2, (point[1] + next[1]) / 2];
              return (
                <circle
                  key={`ghost-${r}-${n}`}
                  className="globeghost"
                  cx={across(mid[0])}
                  cy={down(mid[1])}
                  r={4 * near}
                  onClick={() => alter(r, n, (held) => added(held, n + 1, mid))}
                />
              );
            })
          )}

          {draft.runs.map((run, r) =>
            run.map((point, n) => (
              <circle
                key={`corner-${r}-${n}`}
                className={`globecorner${tool === "erase" ? " cutting" : ""}`}
                data-corner={`${r}:${n}`}
                cx={across(point[0])}
                cy={down(point[1])}
                r={6 * near}
                onDoubleClick={() => alter(r, n, (held) => dropped(held, n))}
              />
            ))
          )}
        </g>
      )}

      {pen && pen.length > 1 && (
        <path
          className="globepen"
          style={{ strokeWidth: 2 * near }}
          d={"M " + pen.map(([lon, lat]) => `${across(lon)} ${down(lat)}`).join(" L ")}
        />
      )}
    </svg>

    {editing && wrong && (
      <div className="globewrong" onClick={() => setWrong(null)}>
        {wrong}
      </div>
    )}

    {editing && !wrong && shifted && (
      <div className="globemoved" onClick={() => setMoved(null)}>
        {shifted.length} {shifted.length === 1 ? "place" : "places"} changed hands:{" "}
        {shifted.slice(0, 4).map((m) => m.id.replace(/-/g, " ")).join(", ")}
        {shifted.length > 4 ? " …" : ""}
      </div>
    )}
    </>
  );
}
