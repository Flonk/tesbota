"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runsOf } from "../shaping";
import {
  across, boxOf, CLOSEST, down, H, hold, LIMIT, latOf, lonOf, metresPerPixel, project, RAD, W,
} from "./projection";

const FIT = { x: 0, y: 0, w: W, h: H };

/** Put a shape in the window, with room around it. */
function frame(place, close = false) {
  if (close && place.lat !== null && place.lon !== null) {
    const degrees = 3000 / (111320 * Math.cos(place.lat * RAD));
    const w = hold((degrees / 360) * W, W / CLOSEST, W);
    const x = across(place.lon);
    const y = down(place.lat);
    return { x: x - w / 2, y: y - (w * H) / W / 2, w, h: (w * H) / W };
  }
  const read = runsOf(place.extent);
  const box = read && boxOf(read.runs.flatMap(project));
  const wide = box ? Math.max(box.maxX - box.minX, (box.maxY - box.minY) * (W / H)) * 3 : W / 400;
  const x = box ? (box.minX + box.maxX) / 2 : across(place.lon);
  const y = box ? (box.minY + box.maxY) / 2 : down(place.lat);
  const w = hold(wide, W / CLOSEST, W);
  return { x: x - w / 2, y: y - (w * H) / W / 2, w, h: (w * H) / W };
}

export function useViewport(body, focus, byId) {
  const svg = useRef(null);
  const [view, setView] = useState(FIT);
  const [pane, setPane] = useState({ w: 0, h: 0 });
  const viewRef = useRef(FIT);
  const aimed = useRef(null);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // A fresh world starts whole again — only when it is a different world, so an
  // effect run twice does not undo having been asked to come down to somewhere.
  const shownBody = useRef(null);
  useEffect(() => {
    if (shownBody.current === body?.id) return;
    shownBody.current = body?.id;
    aimed.current = null;
    setView(FIT);
  }, [body?.id]);

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

  // Everything drawn on top of the world is kept the same size on the screen
  // however close you are, the way a pin does not grow when a map is zoomed. One
  // user unit at this scale is one pixel, so the numbers below are pixels — and
  // because the world covers its pane, the scale comes from whichever side of it
  // is doing the covering.
  const k = pane.w && pane.h ? Math.max(pane.w / view.w, pane.h / view.h) : W / view.w;
  const near = 1 / k;
  const perPixel = body?.radius && pane.w && pane.h ? metresPerPixel(body.radius, latOf(view.y + view.h / 2), k) : null;

  // Where the picture is measured from. A browser draws in single precision, and
  // six figures of zoom on a number near 800 leaves nothing of it below the pixel:
  // lines vanish, corners jitter, circles go square. So everything drawn is
  // measured from a point near the middle of the view, which only moves when the
  // view has moved a whole screen away from it.
  const ox = Math.round((view.x + view.w / 2) / view.w) * view.w;
  const oy = Math.round((view.y + view.h / 2) / view.w) * view.w;
  const origin = useMemo(() => ({ x: ox, y: oy }), [ox, oy]);

  /**
   * Where the picture actually sits on the screen, so a finger can be put on it.
   * The world covers its pane rather than sitting letterboxed inside it, so the
   * scale is whichever of the two is larger and the overflow is simply cropped.
   */
  const framed = useCallback(() => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return null;
    const now = viewRef.current;
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

  // Asked for from outside: come down to it.
  useEffect(() => {
    if (!focus?.id) return;
    const key = `${focus.id}:${focus.asked ?? ""}`;
    if (aimed.current === key) return;
    const place = byId.get(focus.id);
    if (!place || (place.lat === null && !place.extent)) return;
    aimed.current = key;
    setView(settle(frame(place, !!focus.close)));
  }, [focus?.id, focus?.asked, byId, settle]);

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
  const spot = useCallback(
    (clientX, clientY) => {
      const f = framed();
      if (!f) return null;
      const now = viewRef.current;
      return [
        hold(lonOf(now.x + (clientX - f.ox) / f.k), -180, 180),
        hold(latOf(now.y + (clientY - f.oy) / f.k), -LIMIT, LIMIT),
      ];
    },
    [framed]
  );

  const pan = (from, dx, dy) => {
    const f = framed();
    if (f) setView(settle({ ...from, x: from.x - dx / f.k, y: from.y - dy / f.k }));
  };

  return { svg, view, viewRef, pane, k, near, perPixel, origin, framed, zoomAt, spot, pan };
}
