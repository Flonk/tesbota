"use client";

import { useEffect, useRef, useState } from "react";
import { typing } from "../keyboard";
import { openDossier } from "../ui";
import { grown, TOOLS } from "./editor";
import { about, boxOf, carried, H, hold, onMap, onWorld, project, shifted, stretched, turned, W } from "./projection";

const SLOP = 4;
const SNAP = Math.PI / 12;

function gripped({ grip, start, box }, at, e) {
  const middle = [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2];
  if (grip === "move") {
    return shifted(hold(at[0] - start[0], -box.minX, W - box.maxX), hold(at[1] - start[1], -box.minY, H - box.maxY));
  }
  if (grip === "spin") {
    let angle = Math.atan2(at[1] - middle[1], at[0] - middle[0]) - Math.atan2(start[1] - middle[1], start[0] - middle[0]);
    if (e.shiftKey) angle = Math.round(angle / SNAP) * SNAP;
    return about(middle, turned(angle));
  }
  const east = grip.includes("e"), west = grip.includes("w");
  const south = grip.includes("s"), north = grip.includes("n");
  const edgeX = east ? box.maxX : west ? box.minX : null;
  const edgeY = south ? box.maxY : north ? box.minY : null;
  const fixed = [e.altKey ? middle[0] : east ? box.minX : box.maxX, e.altKey ? middle[1] : south ? box.minY : box.maxY];
  const ratio = (edge, moved, anchor) => {
    const span = edge - anchor;
    if (edge === null || Math.abs(span) < 1e-12) return null;
    const r = (edge + moved - anchor) / span;
    return Math.abs(r) < 1e-3 ? Math.sign(r || 1) * 1e-3 : r;
  };
  let sx = ratio(edgeX, at[0] - start[0], fixed[0]);
  let sy = ratio(edgeY, at[1] - start[1], fixed[1]);
  if (e.shiftKey) {
    const even = sx === null ? sy : sy === null ? sx : Math.abs(sx) > Math.abs(sy) ? sx : sy;
    sx = sy = even;
  }
  return about(fixed, stretched(sx ?? 1, sy ?? 1));
}

function hitsAt(svg, x, y, chosen, draft) {
  const hits = [];
  for (const el of document.elementsFromPoint(x, y)) {
    if (!svg?.contains(el)) continue;
    const d = el.dataset || {};
    if (d.corner) hits.push({ corner: d.corner.split(":").map(Number) });
    else if (d.grip) hits.push({ grip: d.grip });
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

export function useGestures({ viewport, editor, editing, body }) {
  const gesture = useRef(null);
  const fingers = useRef(new Map());
  const pinch = useRef(0);
  const keys = useRef(null);
  const [spaced, setSpaced] = useState(false);
  const { chosen, draft, carry, tool, picked, dispatch } = editor;

  useEffect(() => {
    gesture.current = null;
  }, [editing, body?.id]);

  const hits = (x, y) => hitsAt(viewport.svg.current, x, y, chosen, draft);

  function clicked(x, y) {
    const all = hits(x, y);
    const places = [];
    let through = false;
    for (const hit of all) {
      if (hit.draft) through = true;
      else if (hit.place && hit.place !== chosen && !places.includes(hit.place)) {
        if (!through || editor.riders.has(hit.place)) places.push(hit.place);
      }
    }
    if (!editing) {
      const pin = all.find((hit) => hit.pin);
      if (pin) openDossier(pin.place);
      return;
    }
    if (chosen && tool !== "select") return;
    if (through) return places[0] && editor.choose(places[0]);
    if (chosen) return editor.release();
    if (places[0]) editor.choose(places[0]);
  }

  function abandon() {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.kind === "stroke") editor.setPen(null);
    if (g.moved && (g.kind === "corner" || g.kind === "shove")) dispatch({ type: "abandon", before: g.before });
  }

  function press(e) {
    if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
    if (e.button === 1) e.preventDefault();
    viewport.svg.current?.setPointerCapture(e.pointerId);
    fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.current.size >= 2) {
      abandon();
      pinch.current = 0;
      return;
    }

    const g = {
      id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false,
      from: { ...viewport.viewRef.current }, before: { draft, carry }, kind: "pan",
    };
    gesture.current = g;
    if (!editing || e.button === 1 || spaced) return;

    const top = hits(e.clientX, e.clientY)[0] || {};
    if (tool === "erase" && top.corner) {
      g.kind = "none";
      editor.erase(...top.corner);
    } else if (tool === "corners" && top.corner) {
      g.kind = "corner";
      [g.run, g.at] = top.corner;
      editor.pick({ run: g.run, at: g.at });
    } else if (tool === "corners" && top.ghost) {
      g.kind = "ghost";
      [g.run, g.at] = top.ghost;
    } else if (tool === "draw" && chosen) {
      g.kind = "stroke";
      const point = viewport.spot(e.clientX, e.clientY);
      g.points = point ? [point] : [];
    } else if (tool === "select" && (top.draft || top.grip) && draft?.runs.some((r) => r.length)) {
      const at = viewport.spot(e.clientX, e.clientY);
      if (!at) return;
      g.kind = "shove";
      g.grip = top.grip || "move";
      g.start = onMap(at);
      g.runs = draft.runs;
      g.box = boxOf(g.runs.flatMap(project));
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
      if (span > 0 && last > 0) viewport.zoomAt((one.x + two.x) / 2, (one.y + two.y) / 2, last / span);
      return;
    }

    const g = gesture.current;
    if (!g || g.id !== e.pointerId || g.kind === "none") return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (g.kind === "stroke") {
      const point = viewport.spot(e.clientX, e.clientY);
      if (point) g.points.push(point);
    }
    if (!g.moved) {
      if (Math.hypot(dx, dy) < SLOP) return;
      g.moved = true;
      if (g.kind === "ghost") {
        const [at, point] = grown(draft.runs[g.run], g.at, viewport.near);
        dispatch({ type: "grow", run: g.run, at, point });
        g.kind = "corner";
        g.at = at;
      }
    }

    if (g.kind === "pan") return viewport.pan(g.from, dx, dy);
    const point = viewport.spot(e.clientX, e.clientY);
    if (!point) return;
    if (g.kind === "corner") {
      dispatch({ type: "corner", run: g.run, at: g.at, point });
    } else if (g.kind === "shove") {
      const by = gripped(g, onMap(point), e);
      const runs = carried(g.runs, by);
      if (!onWorld(runs)) return;
      // The ground and what stands on it go together while the hand is still
      // down, not only once it has let go.
      dispatch({ type: "shove", runs, by });
      g.by = by;
    } else if (g.kind === "stroke") {
      editor.setPen([...g.points]);
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
        const [at, point] = grown(draft.runs[g.run], g.at, viewport.near);
        return dispatch({ type: "grow", run: g.run, at, point, keep: true });
      }
      if (g.kind === "stroke") editor.setPen(null);
      return clicked(e.clientX, e.clientY);
    }

    if (g.kind === "corner") {
      dispatch({ type: "cornered", before: g.before });
    } else if (g.kind === "shove") {
      dispatch({ type: "shoved", before: g.before, by: g.by });
    } else if (g.kind === "stroke") {
      editor.setPen(null);
      const f = viewport.framed();
      if (f) editor.finish(g.points, f.k);
    }
  }

  keys.current = (e) => {
    if (typing(e.target)) return;
    if (e.key === "Enter" && e.target?.closest?.("button")) return;
    const key = e.key.toLowerCase();
    const mod = e.metaKey || e.ctrlKey;
    if (editor.asking) {
      if (e.key === "Escape") editor.setAsking(null);
      return;
    }
    if (mod && key === "z") {
      e.preventDefault();
      return e.shiftKey ? editor.redo() : editor.undo();
    }
    if (mod && key === "y") {
      e.preventDefault();
      return editor.redo();
    }
    if (mod || e.altKey) return;
    if (e.key === "Escape") {
      if (gesture.current) return abandon();
      if (editor.naming) return editor.setNaming(null);
      if (picked) return editor.pick(null);
      return editor.release();
    }
    if (e.key === "Enter") return editor.dirty && editor.keep();
    if ((e.key === "Delete" || e.key === "Backspace") && picked) {
      e.preventDefault();
      return editor.erase(picked.run, picked.at);
    }
    const next = TOOLS.find((t) => t.key === key);
    if (next) editor.pickTool(next.id);
  };

  useEffect(() => {
    if (!editing) return;
    const pressed = (e) => {
      if (e.key === " " && !typing(e.target)) {
        e.preventDefault();
        if (e.target?.closest?.("button")) e.target.blur();
        setSpaced(true);
        return;
      }
      keys.current?.(e);
    };
    const released = (e) => {
      if (e.key !== " " || typing(e.target)) return;
      e.preventDefault();
      setSpaced(false);
    };
    const gone = () => setSpaced(false);
    window.addEventListener("keydown", pressed);
    window.addEventListener("keyup", released);
    window.addEventListener("blur", gone);
    return () => {
      window.removeEventListener("keydown", pressed);
      window.removeEventListener("keyup", released);
      window.removeEventListener("blur", gone);
    };
  }, [editing]);

  return { press, move, lift, spaced };
}
