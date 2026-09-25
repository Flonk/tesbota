"use client";

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { send } from "../http";
import {
  added, covers, dropped, extentOf, moved, opened, rerun, rework, runsOf, spread, straighten,
} from "../shaping";
import { isRun } from "../world";
import { hold, LIMIT, offMap, onMap, project } from "./projection";

export const UNWRITTEN = "\u0000new";

export const TOOLS = [
  { id: "select", label: "select", icon: "arrow", key: "v" },
  { id: "corners", label: "corners", icon: "node", key: "a" },
  { id: "draw", label: "draw", icon: "pen", key: "p" },
  { id: "erase", label: "erase", icon: "eraser", key: "e" },
];

const REACH = 16;

const IDLE = {
  chosen: null,
  fresh: null,
  draft: null,
  // How far the whole shape has been carried, and whether what stood on it comes.
  carry: null,
  bringing: true,
  // How far the hand has got this drag, before it has let go.
  towed: null,
  past: [],
  future: [],
  picked: null,
};

const sum = (a, b) => ({ lon: (a?.lon || 0) + (b?.lon || 0), lat: (a?.lat || 0) + (b?.lat || 0) });

function draftOf(place) {
  const read = runsOf(place.extent);
  const shut = !isRun(place.type);
  const width = shut ? null : place.width ?? null;
  return read
    ? { ...read, runs: read.shut ? read.runs.map(opened) : read.runs, width }
    : { shut, runs: [[]], groups: [0], width };
}

const blank = (type) => ({ shut: !isRun(type), runs: [[]], groups: [0], width: null });

const onRun = (draft, i, change) => ({ ...draft, runs: draft.runs.map((r, n) => (n === i ? change(r) : r)) });

const kept = (state) => ({ draft: state.draft, carry: state.carry });
const remember = (state, before = kept(state)) => ({ past: [...state.past.slice(-199), before], future: [] });

function edit(state, a) {
  switch (a.type) {
    case "take":
      return { ...IDLE, chosen: a.place.id, draft: draftOf(a.place) };
    case "found":
      return { ...IDLE, chosen: UNWRITTEN, fresh: { id: UNWRITTEN, ...a.fresh }, draft: blank(a.fresh.type) };
    case "release":
      return IDLE;
    case "blank":
      return { ...state, draft: blank(state.fresh.type), carry: null, picked: null, past: [], future: [] };
    case "commit":
      return { ...state, ...remember(state), draft: a.draft, picked: a.picked === undefined ? state.picked : a.picked };
    case "corner":
      return state.draft ? { ...state, draft: onRun(state.draft, a.run, (r) => moved(r, a.at, a.point)) } : state;
    case "grow": {
      const draft = onRun(state.draft, a.run, (r) => added(r, a.at, a.point));
      return { ...state, ...(a.keep ? remember(state) : {}), draft, picked: { run: a.run, at: a.at } };
    }
    case "shove":
      return state.draft ? { ...state, draft: { ...state.draft, runs: a.runs }, towed: a.by } : state;
    case "cornered":
      return { ...state, ...remember(state, a.before) };
    case "shoved":
      return a.by && (a.by.lon || a.by.lat)
        ? { ...state, ...remember(state, a.before), towed: null, carry: sum(state.carry, a.by) }
        : { ...state, towed: null };
    case "abandon":
      return { ...state, ...a.before, towed: null };
    case "undo": {
      if (!state.past.length) return state;
      return {
        ...state,
        ...state.past[state.past.length - 1],
        past: state.past.slice(0, -1),
        future: [kept(state), ...state.future],
        picked: null,
      };
    }
    case "redo": {
      if (!state.future.length) return state;
      return {
        ...state,
        ...state.future[0],
        past: [...state.past, kept(state)],
        future: state.future.slice(1),
        picked: null,
      };
    }
    case "pick":
      return { ...state, picked: a.at };
    case "bring":
      return { ...state, bringing: !state.bringing };
    case "written":
      return { ...state, chosen: a.id, fresh: { ...state.fresh, id: a.id }, picked: null };
    case "saved":
      return { ...state, carry: null, towed: null, past: [], future: [] };
    default:
      return state;
  }
}

/**
 * Where a new corner goes when a ghost is taken hold of: halfway along its edge,
 * or for the + past either end of a line, a little way on in the direction the
 * line was already going.
 */
export function grown(run, at, near) {
  if (at !== "start" && at !== "end") {
    const next = run[(at + 1) % run.length];
    return [at + 1, [(run[at][0] + next[0]) / 2, (run[at][1] + next[1]) / 2]];
  }
  const [last, before] = at === "end" ? [run[run.length - 1], run[run.length - 2]] : [run[0], run[1]];
  const a = onMap(last);
  const b = onMap(before);
  const long = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
  const reach = 26 * near;
  const [lon, lat] = offMap([a[0] + ((a[0] - b[0]) / long) * reach, a[1] + ((a[1] - b[1]) / long) * reach]);
  return [at === "end" ? run.length : 0, [hold(lon, -180, 180), hold(lat, -LIMIT, LIMIT)]];
}

export function useShapeEditor({ body, tree, editing, onSaved, onDirty }) {
  // What is being reshaped, and the shape as it stands before it is written down.
  const [state, dispatch] = useReducer(edit, IDLE);
  const { chosen, fresh, draft, carry, bringing, towed, past } = state;
  const [tool, setTool] = useState("select");
  const [pen, setPen] = useState(null);
  const [saving, setSaving] = useState(false);
  const [wrong, setWrong] = useState(null);
  const [movedNote, setMovedNote] = useState(null);
  // Writing down a place that does not exist yet, before there is a shape for it.
  const [naming, setNaming] = useState(null);
  // Taking a place out, and whether what is in it goes too.
  const [asking, setAsking] = useState(null);
  const { byId } = tree;

  useEffect(() => {
    dispatch({ type: "release" });
    setPen(null);
    setTool("select");
    setWrong(null);
    setNaming(null);
    setAsking(null);
    setMovedNote(null);
  }, [editing, body?.id]);

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
    const size = spread(rings.runs);
    const above = new Set(tree.ancestors(chosen).map((p) => p.id));
    return new Set(
      [...byId.values()]
        .filter((p) => {
          if (p.id === chosen || above.has(p.id) || !p.pin || !covers(rings.runs, p.pin)) return false;
          const own = runsOf(p.extent);
          return !own?.shut || spread(own.runs) < size;
        })
        .map((p) => p.id)
    );
  }, [tree, byId, chosen]);

  const total = carry || towed ? sum(carry, towed) : null;
  const towing = bringing && total && riders.size ? total : null;
  const rides = useCallback(
    (id) => (towing && riders.has(id) ? towing : null),
    [towing, riders]
  );

  const taken =
    (chosen && byId.get(chosen)) || (chosen && fresh?.id === chosen ? fresh : null);
  const dirty = past.length > 0;

  useEffect(() => {
    if (!onDirty) return;
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);

  useEffect(() => {
    if (!dirty) return;
    const stay = (e) => e.preventDefault();
    window.addEventListener("beforeunload", stay);
    return () => window.removeEventListener("beforeunload", stay);
  }, [dirty]);

  /** Take up a shape to work on, as it is written. */
  function take(place) {
    dispatch({ type: "take", place });
    setWrong(null);
  }

  const pick = (at) => dispatch({ type: "pick", at });
  const pickTool = (next) => {
    if (next !== tool) pick(null);
    setTool(next);
  };

  function release() {
    if (!chosen) return true;
    if (dirty) {
      setWrong("unsaved changes: save, or revert");
      return false;
    }
    dispatch({ type: "release" });
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
    if (chosen === UNWRITTEN) return dispatch({ type: "blank" });
    const place = byId.get(chosen);
    if (place) take(place);
  }

  function erase(run, at) {
    const points = draft?.runs[run];
    if (!points) return;
    const least = draft.shut ? 3 : 2;
    if (points.length <= least) {
      setWrong(draft.shut ? "a shape needs three corners" : "a line needs two points");
      return;
    }
    dispatch({ type: "commit", draft: onRun(draft, run, (r) => dropped(r, at)), picked: null });
  }

  const widen = (metres) => dispatch({ type: "commit", draft: { ...draft, width: metres && metres > 0 ? metres : null } });

  /**
   * Put down a place nobody has written, then take it straight up to be drawn.
   */
  function found() {
    const name = (naming?.name || "").trim();
    if (!name || saving) return;
    if (!release()) return;
    dispatch({ type: "found", fresh: { name, type: naming.type } });
    setNaming(null);
    setTool("draw");
  }

  async function remove() {
    if (!asking || saving) return;
    setSaving(true);
    setWrong(null);
    const { error } = await send("/api/place", { id: asking.id, deep: asking.deep }, "DELETE");
    setSaving(false);
    if (error) return setWrong(error);
    setAsking(null);
    dispatch({ type: "release" });
    if (onSaved) onSaved();
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
        const made = await send("/api/place", { name: fresh.name, type: fresh.type, on: body.id });
        if (made.error || !made.payload.id) return setWrong(made.error || "the place was not written");
        id = made.payload.id;
        dispatch({ type: "written", id });
      }
      const shaped = await send("/api/shape", {
        id, extent, carry, alone: !bringing,
        ...(draft.shut ? {} : { width: draft.width ?? null }),
      });
      if (shaped.error) {
        if (id !== chosen && onSaved) onSaved();
        return setWrong(shaped.error);
      }
      // Whatever the new shape now holds, or has let go of, it says so.
      const moving = shaped.payload.carried || [];
      const shifting = [...moving.map((at) => ({ id: at })), ...(shaped.payload.moved || [])];
      setMovedNote(shifting.length ? shifting : null);
      dispatch({ type: "saved" });
      if (onSaved) onSaved();
    } finally {
      setSaving(false);
    }
  }

  function finish(stroke, scale) {
    if (!draft || stroke.length < 2) return;
    const px = 1 / scale;
    const room = px * 3;
    const reach = px * REACH;
    const line = project(stroke);
    const back = (run) => run.map(offMap);
    const filled = draft.runs.filter((r) => r.length);
    if (!filled.length) {
      const straight = straighten(line, room, draft.shut);
      if (!straight) return;
      const points = back(straight.shut ? opened(straight.points) : straight.points);
      return dispatch({ type: "commit", draft: { ...draft, runs: [points], groups: [0] } });
    }
    for (let n = 0; n < draft.runs.length; n++) {
      const run = draft.runs[n];
      if (!run.length) continue;
      const altered = draft.shut
        ? rework(project(run), line, room, reach)
        : rerun(project(run), line, room, reach);
      if (altered) {
        return dispatch({ type: "commit", draft: onRun(draft, n, () => back(altered)) });
      }
    }
    setWrong(draft.shut ? "start and end the stroke on the outline" : "start or end the stroke on the line");
  }

  return {
    ...state,
    dispatch,
    tool,
    pickTool,
    pen,
    setPen,
    saving,
    wrong,
    setWrong,
    movedNote,
    setMovedNote,
    naming,
    setNaming,
    asking,
    setAsking,
    riders,
    rides,
    total,
    taken,
    dirty,
    undo: () => dispatch({ type: "undo" }),
    redo: () => dispatch({ type: "redo" }),
    bring: () => dispatch({ type: "bring" }),
    pick,
    release,
    choose,
    revert,
    erase,
    widen,
    found,
    remove,
    keep,
    finish,
  };
}
