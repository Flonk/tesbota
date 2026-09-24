"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openDossier } from "./ui";
import {
  added, carried, covers, dropped, extentOf, moved, opened, rerun, rework, runsOf, straighten,
} from "./shaping";
import { Act, Palette, Row } from "./ui";

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

/** How many pixels across a place has to be on screen before it opens into what it holds. */
const OPEN = 360;

/** How close two pins may come on the screen, in pixels, before they are one mark. */
const TOUCH = 22;

/**
 * Which places get a pin at this distance. A place too small on the screen to be
 * looked into is one pin, standing for itself and everything inside it; one big
 * enough opens, loses its pin, and what it holds is asked the same question. So a
 * world map says the plains, and coming down to the plains it says the villages.
 */
function resolve(standing, sizes, scale) {
  const known = new Map(standing.map((p) => [p.id, p]));
  const under = new Map();
  for (const place of standing) {
    const up = known.has(place.parent) ? place.parent : null;
    if (!under.has(up)) under.set(up, []);
    under.get(up).push(place);
  }
  const all_of = (place, seen = new Set()) => {
    if (seen.has(place.id)) return [];
    seen.add(place.id);
    return [place, ...(under.get(place.id) || []).flatMap((kid) => all_of(kid, seen))];
  };
  const pins = [];
  const visit = (place, seen) => {
    if (seen.has(place.id)) return;
    seen.add(place.id);
    const box = sizes.get(place.id);
    const wide = box ? Math.max(box.maxX - box.minX, box.maxY - box.minY) * scale : 0;
    if (wide >= OPEN) {
      for (const kid of under.get(place.id) || []) visit(kid, seen);
      return;
    }
    const at = place.lat !== null && place.lon !== null
      ? { lat: place.lat, lon: place.lon }
      : box ? { lat: latOf((box.minY + box.maxY) / 2), lon: lonOf((box.minX + box.maxX) / 2) } : null;
    if (at) pins.push({ place, ...at, all: all_of(place), wide });
  };
  const seen = new Set();
  for (const top of under.get(null) || []) visit(top, seen);
  return pins;
}

/**
 * Pins that would sit on top of each other are one mark. The biggest place among
 * them names it, unless the adventurer is standing in one of them.
 */
function gather(pins, here, scale) {
  const weight = (pin) => (pin.place.type === "road" || pin.place.type === "river" ? -1 : pin.wide);
  const groups = [];
  for (const pin of [...pins].sort((a, b) => weight(b) - weight(a) || b.all.length - a.all.length)) {
    const x = across(pin.lon) * scale;
    const y = down(pin.lat) * scale;
    const near = groups.find((g) => Math.hypot(g.x - x, g.y - y) < TOUCH);
    if (near) near.pins.push(pin);
    else groups.push({ x, y, pins: [pin] });
  }
  const held = new Map(groups.map((g, n) => [n, g.pins]));
  return [...held.values()].map((group) => {
    const all = group.flatMap((pin) => pin.all);
    const holding = group.find((pin) => pin.all.some((p) => p.id === here));
    const said = holding || group.reduce((a, b) =>
      weight(b) > weight(a) || (weight(b) === weight(a) && b.all.length > a.all.length) ? b : a
    );
    return {
      id: said.place.id,
      name: said.place.name,
      lat: said.lat,
      lon: said.lon,
      day: said.place.day,
      altitude: said.place.altitude,
      here: !!holding,
      more: all.length - 1,
      all,
    };
  });
}

const FIT = { x: 0, y: 0, w: W, h: H };

const TOOLS = [
  { id: "select", label: "select", icon: "arrow", key: "v" },
  { id: "corners", label: "corners", icon: "node", key: "a" },
  { id: "draw", label: "draw", icon: "pen", key: "p" },
  { id: "erase", label: "erase", icon: "eraser", key: "e" },
];

const HINT = {
  select: "click a place to select it",
  corners: "click a place, then drag its corners",
  draw: "click a place, then draw across its outline",
  erase: "click a place, then click corners to remove them",
};

const VIEWS = [
  { id: "bodies", label: "celestial bodies", icon: "orbit" },
  { id: "night", label: "terminator", icon: "phase" },
  { id: "grid", label: "grid", icon: "grid" },
];

const SHOWN = "tesbota.map.shown";

const SLOP = 4;
const REACH = 16;
const UNWRITTEN = "\u0000new";

const unwrapped = (x) => (x / W) * 360 - 180;
const onto_map = ([lon, lat]) => [straight(lon), down(lat)];
const off_map = ([x, y]) => [unwrapped(x), latOf(y)];

export default function Globe({
  body,
  here,
  focus = null,
  onCentre = null,
  editing = false,
  onSaved = null,
  onDirty = null,
}) {
  const [view, setView] = useState(FIT);
  const [coarse, setCoarse] = useState(false);
  const [shown, setShown] = useState({ bodies: true, night: true, grid: false });
  const [pane, setPane] = useState({ w: 0, h: 0 });
  // What is being reshaped, and the shape as it stands before it is written down.
  const [chosen, setChosen] = useState(null);
  const [draft, setDraft] = useState(null);
  const [tool, setTool] = useState("select");
  const [pen, setPen] = useState(null);
  const [saving, setSaving] = useState(false);
  const [wrong, setWrong] = useState(null);
  const [shifted, setMoved] = useState(null);
  // How far the whole shape has been carried, and whether what stood on it comes.
  const [carry, setCarry] = useState(null);
  const [bringing, setBringing] = useState(true);
  // How far the hand has got this drag, before it has let go.
  const [towed, setTowed] = useState(null);
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [picked, setPicked] = useState(null);
  const [spaced, setSpaced] = useState(false);
  // Writing down a place that does not exist yet, before there is a shape for it.
  const [naming, setNaming] = useState(null);
  const [fresh, setFresh] = useState(null);
  // Taking a place out, and whether what is in it goes too.
  const [asking, setAsking] = useState(null);
  const svg = useRef(null);
  const held = useRef(FIT);
  const live = useRef({ draft: null, carry: null });
  const gesture = useRef(null);
  const fingers = useRef(new Map());
  const pinch = useRef(0);
  const aimed = useRef(null);
  const keys = useRef(null);

  useEffect(() => {
    held.current = view;
  }, [view]);

  useEffect(() => {
    live.current = { draft, carry };
  }, [draft, carry]);

  useEffect(() => {
    setPicked(null);
  }, [tool, chosen]);

  useEffect(() => {
    try {
      const kept = JSON.parse(window.localStorage.getItem(SHOWN) || "null");
      if (kept && typeof kept === "object") setShown((was) => ({ ...was, ...kept }));
    } catch {}
  }, []);

  const flip = (id) =>
    setShown((was) => {
      const next = { ...was, [id]: !was[id] };
      try {
        window.localStorage.setItem(SHOWN, JSON.stringify(next));
      } catch {}
      return next;
    });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(pointer: coarse)");
    const read = () => setCoarse(query.matches);
    read();
    query.addEventListener?.("change", read);
    return () => query.removeEventListener?.("change", read);
  }, []);

  // A fresh world starts whole again.
  useEffect(() => {
    setView(FIT);
  }, [body?.id]);

  useEffect(() => {
    setChosen(null);
    setDraft(null);
    setPen(null);
    setCarry(null);
    setTowed(null);
    setPast([]);
    setFuture([]);
    setPicked(null);
    setTool("select");
    setWrong(null);
    setNaming(null);
    setFresh(null);
    setAsking(null);
    setMoved(null);
    gesture.current = null;
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
  const standing = body?.standing || [];
  const byId = useMemo(() => new Map(standing.map((p) => [p.id, p])), [standing]);

  /**
   * What would be carried if this ground were moved — worked out from the shape as
   * written, the same way the record will work it out when it is asked to save.
   * Holding it here is what lets the map show a village moving with its houses
   * rather than showing the ground slide out from under them.
   */
  const riders = useMemo(() => {
    const ground = byId.get(chosen);
    const rings = ground?.extent ? runsOf(ground.extent) : null;
    if (!rings?.shut) return new Set();
    const above = new Set();
    for (let at = ground.parent; at && !above.has(at); at = byId.get(at)?.parent) above.add(at);
    return new Set(
      standing
        .filter(
          (p) => p.id !== chosen && !above.has(p.id) && p.lat !== null && p.lon !== null &&
            covers(rings.runs, [p.lon, p.lat])
        )
        .map((p) => p.id)
    );
  }, [standing, byId, chosen]);

  const sum = (a, b) => ({ lon: (a?.lon || 0) + (b?.lon || 0), lat: (a?.lat || 0) + (b?.lat || 0) });
  const total = carry || towed ? sum(carry, towed) : null;
  const towing = bringing && total && riders.size ? total : null;
  const rides = useCallback(
    (id) => (towing && riders.has(id) ? towing : null),
    [towing, riders]
  );

  const marks = useMemo(() => {
    const moving = standing.map((place) => {
      const by = rides(place.id);
      return by ? { ...place, lat: place.lat + by.lat, lon: place.lon + by.lon } : place;
    });
    const sizes = new Map();
    for (const place of moving) {
      const d = place.extent && outline(place.extent);
      const box = d && bounds(d);
      if (box) sizes.set(place.id, box);
    }
    const scale = pane.w && pane.h ? Math.max(pane.w / view.w, pane.h / view.h) : W / view.w;
    return gather(resolve(moving, sizes, scale), here, scale);
  }, [standing, here, view.w, pane, rides]);

  // Ground first, then what runs across it, then what stands on it — so a house
  // is not painted over by the village holding it.
  const drawn = useMemo(() => {
    const order = { water: 0, region: 1, road: 2, river: 2 };
    return standing
      .filter((place) => place.extent && place.id !== chosen)
      .map((place) => {
        const by = rides(place.id);
        const read = by && runsOf(place.extent);
        const shape = read
          ? JSON.stringify(extentOf({ ...read, runs: carried(read.runs, by) }))
          : place.extent;
        let depth = 0;
        for (let at = byId.get(place.parent); at && depth < 6; at = byId.get(at.parent)) depth += 1;
        return { ...place, d: outline(shape), depth };
      })
      .filter((place) => place.d)
      .sort((a, b) => (order[a.type] ?? 2) - (order[b.type] ?? 2) || a.depth - b.depth);
  }, [standing, byId, chosen, rides]);
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
    const at = byId.get(here);
    return at && at.lat !== null && at.lon !== null ? at : null;
  }, [byId, here]);

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
    const key = `${focus.id}:${focus.asked ?? ""}`;
    if (aimed.current === key) return;
    const place = byId.get(focus.id);
    if (!place || (place.lat === null && !place.extent)) return;
    aimed.current = key;
    setView(settle(frame(place)));
  }, [focus?.id, focus?.asked, byId, frame, settle]);

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

  /**
   * Where a new corner goes when a ghost is taken hold of: halfway along its edge,
   * or for the + past either end of a line, a little way on in the direction the
   * line was already going.
   */
  function grown(run, at) {
    if (at !== "start" && at !== "end") {
      const next = run[(at + 1) % run.length];
      return [at + 1, [(run[at][0] + next[0]) / 2, (run[at][1] + next[1]) / 2]];
    }
    const [last, before] = at === "end" ? [run[run.length - 1], run[run.length - 2]] : [run[0], run[1]];
    const a = onto_map(last);
    const b = onto_map(before);
    const long = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
    const reach = 26 * (pane.w && pane.h ? Math.min(view.w / pane.w, view.h / pane.h) : view.w / W);
    const out = off_map([a[0] + ((a[0] - b[0]) / long) * reach, a[1] + ((a[1] - b[1]) / long) * reach]);
    return [at === "end" ? run.length : 0, out];
  }

  /** Where a finger is on the world, rather than on the screen. */
  const spot = useCallback(
    (clientX, clientY) => {
      const f = framed();
      if (!f) return null;
      const now = held.current;
      return [
        hold(unwrapped(now.x + (clientX - f.ox) / f.k), -180, 180),
        hold(latOf(now.y + (clientY - f.oy) / f.k), -LIMIT, LIMIT),
      ];
    },
    [framed]
  );

  const taken =
    (chosen && byId.get(chosen)) || (chosen && fresh?.id === chosen ? fresh : null);
  const dirty = past.length > 0;

  useEffect(() => {
    if (onDirty) onDirty(dirty);
  }, [dirty, onDirty]);

  /** Take up a shape to work on, as it is written. */
  const take = useCallback((place) => {
    const read = place.extent ? runsOf(place.extent) : null;
    const shut = place.type !== "road" && place.type !== "river";
    setChosen(place.id);
    const width = shut ? null : place.width ?? null;
    setDraft(
      read
        ? { ...read, runs: read.shut ? read.runs.map(opened) : read.runs, width }
        : { shut, runs: [[]], groups: [0], width }
    );
    setCarry(null);
    setTowed(null);
    setPast([]);
    setFuture([]);
    setPicked(null);
    setBringing(true);
    setWrong(null);
  }, []);

  function step(next, nextCarry = live.current.carry) {
    const before = live.current;
    setPast((was) => [...was.slice(-199), before]);
    setFuture([]);
    live.current = { draft: next, carry: nextCarry };
    setDraft(next);
    setCarry(nextCarry);
  }

  function undo() {
    if (!past.length) return;
    const back = past[past.length - 1];
    const now = live.current;
    setFuture((was) => [now, ...was]);
    setPast((was) => was.slice(0, -1));
    live.current = back;
    setDraft(back.draft);
    setCarry(back.carry);
    setPicked(null);
  }

  function redo() {
    if (!future.length) return;
    const on = future[0];
    const now = live.current;
    setPast((was) => [...was, now]);
    setFuture((was) => was.slice(1));
    live.current = on;
    setDraft(on.draft);
    setCarry(on.carry);
    setPicked(null);
  }

  function release() {
    if (!chosen) return true;
    if (dirty) {
      setWrong("unsaved changes: save, or revert");
      return false;
    }
    setChosen(null);
    setDraft(null);
    setFresh(null);
    setCarry(null);
    setPast([]);
    setFuture([]);
    setPicked(null);
    setWrong(null);
    return true;
  }

  function choose(id) {
    if (id === chosen) return;
    const place = byId.get(id);
    if (!place) return;
    if (!release()) return;
    take(place);
  }

  function revert() {
    if (chosen === UNWRITTEN) {
      setDraft({ shut: fresh.shut, runs: [[]], groups: [0] });
      setPast([]);
      setFuture([]);
      return;
    }
    const place = byId.get(chosen);
    if (place) take(place);
  }

  function erase(run, at) {
    const now = live.current.draft;
    const held_run = now?.runs[run];
    if (!held_run) return;
    const least = now.shut ? 3 : 2;
    if (held_run.length <= least) {
      setWrong(now.shut ? "a shape needs three corners" : "a line needs two points");
      return;
    }
    step({ ...now, runs: now.runs.map((r, n) => (n === run ? dropped(r, at) : r)) });
    setPicked(null);
  }

  /**
   * Put down a place nobody has written, then take it straight up to be drawn.
   */
  function found() {
    const said = (naming?.name || "").trim();
    if (!said || saving) return;
    if (!release()) return;
    const shut = naming.type !== "road" && naming.type !== "river";
    setFresh({ id: UNWRITTEN, name: said, type: naming.type, shut });
    setNaming(null);
    setChosen(UNWRITTEN);
    setDraft({ shut, runs: [[]], groups: [0] });
    setCarry(null);
    setPast([]);
    setFuture([]);
    setPicked(null);
    setTool("draw");
  }

  /** Everything nested inside a place, by what says it is inside what. */
  const nested = useCallback(
    (id) => {
      const inside = [];
      const walk = (at) => {
        for (const place of standing) {
          if (place.parent !== at || inside.includes(place.id)) continue;
          inside.push(place.id);
          walk(place.id);
        }
      };
      walk(id);
      return inside;
    },
    [standing]
  );

  async function remove() {
    if (!asking || saving) return;
    setSaving(true);
    setWrong(null);
    try {
      const res = await fetch("/api/place", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: asking.id, deep: asking.deep }),
      });
      const back = await res.json().catch(() => null);
      if (back?.error) return setWrong(back.error);
      setAsking(null);
      setChosen(null);
      setDraft(null);
      setFresh(null);
      setCarry(null);
      setTowed(null);
      setPast([]);
      setFuture([]);
      setPicked(null);
      if (onSaved) onSaved();
    } catch (err) {
      setWrong(String(err));
    } finally {
      setSaving(false);
    }
  }

  async function keep() {
    if (!chosen || !draft || saving) return;
    const extent = extentOf(draft);
    if (!extent) return setWrong("not enough of a shape to save");
    setSaving(true);
    setWrong(null);
    try {
      let id = chosen;
      if (chosen === UNWRITTEN) {
        const res = await fetch("/api/place", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: fresh.name, type: fresh.type, on: body.id }),
        });
        const back = await res.json().catch(() => null);
        if (back?.error || !back?.id) return setWrong(back?.error || "the place was not written");
        id = back.id;
        setFresh({ ...fresh, id });
      }
      const res = await fetch("/api/shape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id, extent, carry: bringing ? carry : null,
          ...(draft.shut ? {} : { width: draft.width ?? null }),
        }),
      });
      const back = await res.json().catch(() => null);
      if (back?.error) {
        if (id !== chosen) {
          setChosen(id);
          if (onSaved) onSaved();
        }
        return setWrong(back.error);
      }
      // Whatever the new shape now holds, or has let go of, it says so.
      const moving = back?.carried || [];
      const shifting = [...moving.map((at) => ({ id: at })), ...(back?.moved || [])];
      setMoved(shifting.length ? shifting : null);
      setChosen(id);
      setCarry(null);
      setTowed(null);
      setPast([]);
      setFuture([]);
      if (onSaved) onSaved();
    } catch (err) {
      setWrong(String(err));
    } finally {
      setSaving(false);
    }
  }

  function under(x, y) {
    const hits = [];
    for (const el of document.elementsFromPoint(x, y)) {
      if (!svg.current?.contains(el)) continue;
      const d = el.dataset || {};
      if (d.corner) hits.push({ corner: d.corner.split(":").map(Number) });
      else if (d.ghost) {
        const [run, at] = d.ghost.split(":");
        hits.push({ ghost: [Number(run), at === "start" || at === "end" ? at : Number(at)] });
      }
      else if (d.draft !== undefined) hits.push({ draft: true });
      else {
        const mark = el.closest?.("[data-place]");
        if (mark && mark.dataset.place === chosen && draft) hits.push({ draft: true });
        else if (mark) hits.push({ place: mark.dataset.place, pin: mark.tagName === "g" });
      }
    }
    return hits;
  }

  function clicked(x, y) {
    const hits = under(x, y);
    const places = [];
    let through = false;
    for (const hit of hits) {
      if (hit.draft) through = true;
      else if (hit.place && hit.place !== chosen && !places.includes(hit.place)) {
        if (!through || riders.has(hit.place)) places.push(hit.place);
      }
    }
    if (!editing) {
      const pin = hits.find((hit) => hit.pin);
      if (pin) openDossier(pin.place);
      return;
    }
    if (chosen && tool !== "select") return;
    if (through) return places[0] && choose(places[0]);
    if (chosen) return release();
    if (places[0]) choose(places[0]);
  }

  const fence = (runs) => {
    let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
    for (const run of runs) for (const [lon, lat] of run) {
      w = Math.min(w, lon); e = Math.max(e, lon); s = Math.min(s, lat); n = Math.max(n, lat);
    }
    return { w, e, s, n };
  };

  function finish(stroke) {
    const now = live.current.draft;
    const f = framed();
    if (!now || !f || stroke.length < 2) return;
    const px = 1 / f.k;
    const room = px * 3;
    const reach = px * REACH;
    const line = stroke.map(onto_map);
    const flat = (run) => run.map(onto_map);
    const back = (run) => run.map(off_map);
    const filled = now.runs.filter((r) => r.length);
    if (!filled.length) {
      const said = straighten(line, room, now.shut);
      if (!said) return;
      const points = back(said.shut ? opened(said.points) : said.points);
      return step({ ...now, runs: [points], groups: [0] });
    }
    for (let n = 0; n < now.runs.length; n++) {
      const run = now.runs[n];
      if (!run.length) continue;
      const altered = now.shut
        ? rework(flat(run), line, room, reach)
        : rerun(flat(run), line, room, reach);
      if (altered) {
        return step({ ...now, runs: now.runs.map((r, m) => (m === n ? back(altered) : r)) });
      }
    }
    setWrong(now.shut ? "start and end the stroke on the outline" : "start or end the stroke on the line");
  }

  function abandon() {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.kind === "stroke") setPen(null);
    if (g.moved && (g.kind === "corner" || g.kind === "shove")) {
      setDraft(g.before.draft);
      setCarry(g.before.carry);
      setTowed(null);
    }
  }

  function press(e) {
    if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
    if (e.button === 1) e.preventDefault();
    svg.current?.setPointerCapture(e.pointerId);
    fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.current.size >= 2) {
      abandon();
      pinch.current = 0;
      return;
    }

    const g = {
      id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false,
      from: { ...held.current }, before: live.current, kind: "pan",
    };
    gesture.current = g;
    if (!editing || e.button === 1 || spaced) return;

    const top = under(e.clientX, e.clientY)[0] || {};
    if (tool === "erase" && top.corner) {
      g.kind = "none";
      erase(...top.corner);
    } else if (tool === "corners" && top.corner) {
      g.kind = "corner";
      [g.run, g.at] = top.corner;
      setPicked({ run: g.run, at: g.at });
    } else if (tool === "corners" && top.ghost) {
      g.kind = "ghost";
      [g.run, g.at] = top.ghost;
    } else if (tool === "draw" && chosen) {
      g.kind = "stroke";
      const point = spot(e.clientX, e.clientY);
      g.points = point ? [point] : [];
    } else if (tool === "select" && top.draft) {
      g.kind = "shove";
      g.start = spot(e.clientX, e.clientY);
      g.runs = live.current.draft.runs;
      g.fence = fence(g.runs.filter((r) => r.length));
    }
  }

  function move(e) {
    const finger = fingers.current.get(e.pointerId);
    if (!finger) return;
    finger.x = e.clientX;
    finger.y = e.clientY;

    if (fingers.current.size >= 2) {
      const [one, two] = [...fingers.current.values()];
      const span = Math.hypot(two.x - one.x, two.y - one.y);
      const last = pinch.current || span;
      pinch.current = span;
      if (span > 0 && last > 0) zoomAt((one.x + two.x) / 2, (one.y + two.y) / 2, last / span);
      return;
    }

    const g = gesture.current;
    if (!g || g.id !== e.pointerId || g.kind === "none") return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (g.kind === "stroke") {
      const point = spot(e.clientX, e.clientY);
      if (point) g.points.push(point);
    }
    if (!g.moved) {
      if (Math.hypot(dx, dy) < SLOP) return;
      g.moved = true;
      if (g.kind === "ghost") {
        const now = live.current.draft;
        const run = now.runs[g.run];
        const [at, point] = grown(run, g.at);
        setDraft({ ...now, runs: now.runs.map((r, n) => (n === g.run ? added(r, at, point) : r)) });
        g.kind = "corner";
        g.at = at;
        setPicked({ run: g.run, at: g.at });
      }
    }

    if (g.kind === "pan") {
      const f = framed();
      if (!f) return;
      setView(settle({ ...g.from, x: g.from.x - dx / f.k, y: g.from.y - dy / f.k }));
      return;
    }
    const point = spot(e.clientX, e.clientY);
    if (!point) return;
    if (g.kind === "corner") {
      setDraft((now) =>
        now && { ...now, runs: now.runs.map((r, n) => (n === g.run ? moved(r, g.at, point) : r)) }
      );
    } else if (g.kind === "shove") {
      const { w, e: east, s, n } = g.fence;
      const by = {
        lon: hold(point[0] - g.start[0], -180 - w, 180 - east),
        lat: hold(point[1] - g.start[1], -LIMIT - s, LIMIT - n),
      };
      setDraft((now) => now && { ...now, runs: carried(g.runs, by) });
      // The ground and what stands on it move together while the hand is still
      // down, not only once it has let go.
      setTowed(by);
      g.by = by;
    } else if (g.kind === "stroke") {
      setPen([...g.points]);
    }
  }

  function lift(e) {
    const was = fingers.current.size;
    fingers.current.delete(e.pointerId);
    if (was >= 2) {
      pinch.current = 0;
      gesture.current = null;
      return;
    }
    const g = gesture.current;
    gesture.current = null;
    if (!g || g.id !== e.pointerId) return;
    if (e.type === "pointercancel") {
      gesture.current = g;
      return abandon();
    }

    if (!g.moved) {
      if (g.kind === "none" || g.kind === "corner") return;
      if (g.kind === "ghost") {
        const now = live.current.draft;
        const run = now.runs[g.run];
        const [at, point] = grown(run, g.at);
        step({ ...now, runs: now.runs.map((r, n) => (n === g.run ? added(r, at, point) : r)) });
        setPicked({ run: g.run, at });
        return;
      }
      if (g.kind === "stroke") setPen(null);
      return clicked(e.clientX, e.clientY);
    }

    if (g.kind === "corner") {
      setPast((p) => [...p.slice(-199), g.before]);
      setFuture([]);
    } else if (g.kind === "shove") {
      setTowed(null);
      if (g.by && (g.by.lon || g.by.lat)) {
        setPast((p) => [...p.slice(-199), g.before]);
        setFuture([]);
        setCarry((c) => sum(c, g.by));
      }
    } else if (g.kind === "stroke") {
      setPen(null);
      finish(g.points);
    }
  }

  keys.current = (e) => {
    if (e.target?.closest?.("input, textarea, select, [contenteditable]")) return;
    if (e.key === "Enter" && e.target?.closest?.("button")) return;
    const key = e.key.toLowerCase();
    const mod = e.metaKey || e.ctrlKey;
    if (asking) {
      if (e.key === "Escape") setAsking(null);
      return;
    }
    if (mod && key === "z") {
      e.preventDefault();
      return e.shiftKey ? redo() : undo();
    }
    if (mod && key === "y") {
      e.preventDefault();
      return redo();
    }
    if (mod || e.altKey) return;
    if (e.key === "Escape") {
      if (gesture.current) return abandon();
      if (naming) return setNaming(null);
      if (picked) return setPicked(null);
      return release();
    }
    if (e.key === "Enter") return dirty && keep();
    if ((e.key === "Delete" || e.key === "Backspace") && picked) {
      e.preventDefault();
      return erase(picked.run, picked.at);
    }
    const chosen_tool = TOOLS.find((t) => t.key === key);
    if (chosen_tool) setTool(chosen_tool.id);
  };

  useEffect(() => {
    if (!editing) return;
    const typing = (e) => e.target?.closest?.("input, textarea, select, [contenteditable]");
    const down_key = (e) => {
      if (e.key === " " && !typing(e)) {
        e.preventDefault();
        if (e.target?.closest?.("button")) e.target.blur();
        setSpaced(true);
        return;
      }
      keys.current?.(e);
    };
    const up_key = (e) => {
      if (e.key !== " " || typing(e)) return;
      e.preventDefault();
      setSpaced(false);
    };
    const gone = () => setSpaced(false);
    window.addEventListener("keydown", down_key);
    window.addEventListener("keyup", up_key);
    window.addEventListener("blur", gone);
    return () => {
      window.removeEventListener("keydown", down_key);
      window.removeEventListener("keyup", up_key);
      window.removeEventListener("blur", gone);
    };
  }, [editing]);

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

  const nameOf = (id) => byId.get(id)?.name || id;

  const ruler = (() => {
    if (!body.radius || !pane.w || !pane.h) return null;
    const k = Math.max(pane.w / view.w, pane.h / view.h);
    const middle = latOf(view.y + view.h / 2);
    const perPixel = (2 * Math.PI * body.radius * Math.cos(middle * RAD)) / (W * k);
    const most = perPixel * 110;
    const ten = 10 ** Math.floor(Math.log10(most));
    const length = [5, 2, 1].map((n) => n * ten).find((n) => n <= most) ?? ten;
    return {
      px: length / perPixel,
      perPixel,
      said: length >= 1000 ? `${(length / 1000).toLocaleString()} km` : `${length} m`,
    };
  })();
  const perPixel = ruler ? ruler.perPixel : null;
  const thick = (place, least) =>
    place.width && perPixel ? Math.max(least, place.width / perPixel) : undefined;

  const grid = (() => {
    if (!shown.grid || !ruler) return null;
    const s = ruler.px * near;
    const xs = [];
    const ys = [];
    for (let x = Math.floor(view.x / s) * s; x <= view.x + view.w; x += s) xs.push(x);
    for (let y = Math.floor(view.y / s) * s; y <= view.y + view.h; y += s) ys.push(y);
    return { xs, ys };
  })();

  const handles = editing && draft && (tool === "corners" || tool === "erase");
  const traced = (run) =>
    run.length
      ? "M " + run.map(([lon, lat]) => `${across(lon)} ${down(lat)}`).join(" L ") + (draft.shut ? " Z" : "")
      : "";

  return (
    <>
    {editing && (
      <Row className="shapebar">
        {taken ? (
          <>
            <span className="gname">
              {taken.name}
              {dirty && <span className="gdirty" title="unsaved changes">•</span>}
            </span>
            {draft && !draft.shut && (
              <label className="gwidth" title="width in metres">
                <input
                  className="gtype"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="width"
                  value={draft.width ?? ""}
                  onChange={(e) => {
                    const said = e.target.value === "" ? null : Number(e.target.value);
                    step({ ...live.current.draft, width: said && said > 0 ? said : null });
                  }}
                />
                m
              </label>
            )}
            <Act onClick={() => setNaming({ name: "", type: "region" })} disabled={saving}>
              new place
            </Act>
          </>
        ) : naming ? (
          <>
            <input
              className="gname gtype"
              autoFocus
              value={naming.name}
              placeholder="name"
              onChange={(e) => setNaming({ ...naming, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") found();
                if (e.key === "Escape") setNaming(null);
              }}
            />
            <select
              className="gtool"
              value={naming.type}
              onChange={(e) => setNaming({ ...naming, type: e.target.value })}
            >
              {["region", "water", "location", "road", "river"].map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
            <Act onClick={() => setNaming(null)}>cancel</Act>
            <Act className="keep" onClick={found} disabled={!naming.name.trim()}>
              draw
            </Act>
          </>
        ) : (
          <>
            <span className="gname dim">{HINT[tool]}</span>
            <Act onClick={() => setNaming({ name: "", type: "region" })}>
              new place
            </Act>
          </>
        )}
      </Row>
    )}

    <div className="globepane">
    <svg
      ref={svg}
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      className={`globesvg${editing ? ` editing ${tool}` : ""}${spaced ? " panning" : ""}`}
      preserveAspectRatio="xMidYMid slice"
      role="img"
      onPointerDown={press}
      onPointerMove={move}
      onPointerUp={lift}
      onPointerCancel={lift}
    >
      <rect x="0" y="0" width={W} height={H} className="globeday" />

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
            data-place={place.id}
            className={`globeshape ${place.type || "location"}${place.walked ? " walked" : ""}`}
            style={{ "--depth": Math.min(place.depth, 4), strokeWidth: thick(place, 2.5) }}
          >
            <title>{place.name}</title>
          </path>
        ))}
        {drawn
          .filter((place) => place.type === "road" || place.type === "river")
          .map((place) => (
            <path key={`hit-${place.id}`} d={place.d} data-place={place.id} className="globehit" />
          ))}
      </g>

      {grid && (
        <g className="globeruled">
          {grid.xs.map((x) => (
            <line key={`gx${x}`} x1={x} y1={view.y} x2={x} y2={view.y + view.h} />
          ))}
          {grid.ys.map((y) => (
            <line key={`gy${y}`} x1={view.x} y1={y} x2={view.x + view.w} y2={y} />
          ))}
        </g>
      )}

      {/* Over the ground, not under it. Night that only darkens the sea leaves a
          continent lit at midnight, which is not a map of anything. */}
      {shown.night && <path d={dark} className="globenight" />}

      {shown.bodies && (
        <g className="globesun" transform={`translate(${across(sun.lon)} ${down(sun.lat)}) scale(${near})`}>
          <circle r="7" />
          <circle r="13" className="globeglow" />
          <title>subsolar point</title>
        </g>
      )}

      {draft && (
        <g className="globedraft" style={{ strokeWidth: near }}>
          {draft.runs.map((run, r) => (
            <path
              key={`draft-${r}`}
              data-draft=""
              className={`globeshape ${draft.shut ? "location" : "road"} drafting`}
              style={{ strokeWidth: draft.shut ? undefined : thick(draft, 2) }}
              fillRule="evenodd"
              d={traced(run)}
            />
          ))}
          {!draft.shut && draft.runs.map((run, r) => (
            <path key={`draft-hit-${r}`} data-draft="" className="globehit" d={traced(run)} />
          ))}
        </g>
      )}

      {shown.bodies && (body.overhead || []).map((other) => {
        const dx = wrapped(sun.lon - other.lon);
        const dy = other.lat - sun.lat;
        const far = Math.hypot(dx, dy) || 1;
        const lit = { x: 0.5 + (0.32 * dx) / far, y: 0.5 + (0.32 * dy) / far };
        return (
          <g
            key={`over-${other.id}`}
            className="globemoon"
            transform={`translate(${across(other.lon)} ${down(other.lat)}) scale(${near})`}
          >
            <defs>
              <radialGradient id={`lit-${other.id}`} cx={lit.x} cy={lit.y} fx={lit.x} fy={lit.y} r="0.75">
                <stop offset="0" className="moonlit" />
                <stop offset="0.55" className="moonmid" />
                <stop offset="1" className="moondark" />
              </radialGradient>
            </defs>
            <circle r="6.5" fill={`url(#lit-${other.id})`} />
            <title>{`${other.name} is overhead here`}</title>
          </g>
        );
      })}

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
          data-place={mark.id}
          className={`globemark${mark.here ? " here" : ""}${mark.day ? " lit" : ""}${
            mark.id === chosen ? " chosen" : ""
          }`}
          transform={`translate(${across(mark.lon)} ${down(mark.lat)}) scale(${near})`}
        >
          <circle r="5" />
          {named.has(mark.id) && (
            <text y="-11" textAnchor="middle">
              {mark.name}
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
      {draft && editing && (
        <g className="globedraft">
          {tool === "corners" && draft.runs.map((run, r) =>
            run.map((point, n) => {
              const next = run[(n + 1) % run.length];
              if (run.length < 2 || (!draft.shut && n === run.length - 1)) return null;
              const mid = [(point[0] + next[0]) / 2, (point[1] + next[1]) / 2];
              return (
                <circle
                  key={`ghost-${r}-${n}`}
                  className="globeghost"
                  data-ghost={`${r}:${n}`}
                  cx={across(mid[0])}
                  cy={down(mid[1])}
                  r={(coarse ? 8 : 4) * near}
                />
              );
            })
          )}

          {tool === "corners" && !draft.shut && draft.runs.map((run, r) =>
            run.length >= 2 && ["start", "end"].map((end) => {
              const [, point] = grown(run, end);
              return (
                <g key={`tip-${r}-${end}`} className="globetip">
                  <circle
                    className="globeghost"
                    data-ghost={`${r}:${end}`}
                    cx={across(point[0])}
                    cy={down(point[1])}
                    r={(coarse ? 9 : 6) * near}
                  />
                  <path
                    d={`M ${across(point[0]) - 3 * near} ${down(point[1])} h ${6 * near} M ${across(point[0])} ${down(point[1]) - 3 * near} v ${6 * near}`}
                    style={{ strokeWidth: 1.3 * near }}
                  />
                </g>
              );
            })
          )}

          {draft.runs.map((run, r) =>
            run.map((point, n) => (
              <circle
                key={`corner-${r}-${n}`}
                className={`globecorner${tool === "erase" ? " cutting" : ""}${
                  handles ? "" : " passive"
                }${picked && picked.run === r && picked.at === n ? " picked" : ""}`}
                data-corner={handles ? `${r}:${n}` : undefined}
                cx={across(point[0])}
                cy={down(point[1])}
                r={(handles ? (coarse ? 10 : 6) : 3) * near}
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

    <div className="palettes">
      {editing && <Palette items={TOOLS} value={tool} onChange={setTool} />}
      <Palette items={VIEWS.map((v) => ({ ...v, on: shown[v.id], onClick: () => flip(v.id) }))} />
    </div>

    {editing && taken && (
      <Palette
        across
        items={[
          ...(riders.size > 0
            ? [{
                id: "carry", icon: "stack", on: bringing,
                label: `carry ${riders.size} subplaces`,
                onClick: () => setBringing((was) => !was),
              }]
            : []),
          { id: "undo", icon: "undo", label: "undo", hint: "ctrl Z", off: !past.length || saving, onClick: undo },
          { id: "redo", icon: "redo", label: "redo", hint: "ctrl shift Z", off: !future.length || saving, onClick: redo },
          { id: "revert", icon: "revert", label: "revert", off: !dirty || saving, onClick: revert },
          ...(chosen !== UNWRITTEN
            ? [{
                id: "remove", icon: "trash", label: "remove", tone: "gone", off: saving,
                onClick: () => setAsking({ id: taken.id, name: taken.name, deep: false }),
              }]
            : []),
          { id: "deselect", icon: "cross", label: "deselect", hint: "esc", off: saving, onClick: release },
          { id: "save", icon: "check", label: "save", hint: "enter", tone: "keep", off: !dirty || saving, onClick: keep },
        ]}
      />
    )}

    {editing && asking && (() => {
      const inside = nested(asking.id);
      const going = asking.deep ? inside.length + 1 : 1;
      const up = byId.get(asking.id)?.parent;
      const upName = byId.get(up)?.name || body?.name || "the world";
      return (
        <div className="globeask" onClick={() => !saving && setAsking(null)}>
          <div className="asked" onClick={(e) => e.stopPropagation()}>
            <p className="askwhat">Remove {asking.name}?</p>
            {inside.length > 0 ? (
              <>
                <Act on={asking.deep} onClick={() => setAsking({ ...asking, deep: !asking.deep })}
                >
                  include subplaces
                </Act>
                <p className="askwhy">
                  {asking.deep
                    ? `${inside.length} subplaces deleted too.`
                    : `${inside.length} subplaces move to ${upName}.`}
                </p>
              </>
            ) : (
              <p className="askwhy">Nothing inside it.</p>
            )}
            {wrong && <p className="askwhy bad">{wrong}</p>}
            <div className="askdo">
              <Act onClick={() => setAsking(null)} disabled={saving}>
                cancel
              </Act>
              <Act className="gone" onClick={remove} disabled={saving}>
                {saving ? "…" : `remove ${going} ${going === 1 ? "place" : "places"}`}
              </Act>
            </div>
          </div>
        </div>
      );
    })()}

    {ruler && (
      <div className="globeruler" aria-hidden="true">
        <span>{ruler.said}</span>
        <i style={{ width: `${ruler.px}px` }} />
      </div>
    )}

    {editing && !asking && wrong && (
      <div className="globewrong" onClick={() => setWrong(null)}>
        {wrong}
      </div>
    )}

    {editing && !wrong && shifted && (
      <div className="globemoved" onClick={() => setMoved(null)}>
        moved {shifted.length}: {shifted.slice(0, 4).map((m) => nameOf(m.id)).join(", ")}
        {shifted.length > 4 ? " …" : ""}
      </div>
    )}
    </div>
    </>
  );
}
