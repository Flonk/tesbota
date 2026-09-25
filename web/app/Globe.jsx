"use client";

import { useEffect, useMemo } from "react";
import { covers, runsOf } from "./shaping";
import { useMedia } from "./ui";
import { isRun } from "./world";
import { EditPalette, Notices, Palettes, RemoveDialog, ShapeBar, useShown } from "./map/controls";
import { useShapeEditor } from "./map/editor";
import { useGestures } from "./map/gestures";
import {
  Draft, Gizmo, Graticule, Handles, LAYER, Moons, Night, Pins, Ruled, Scale, Shapes, Stroke, Sun, Trip, Words,
} from "./map/layers";
import { gather, resolve, treeOf } from "./map/pins";
import { boxOf, carried, carriedTo, H, project, W } from "./map/projection";
import { useViewport } from "./map/viewport";

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

/**
 * How much of the picture a place has to fill before the map will say that is
 * what you are looking at. Below this it is ground you happen to be over rather
 * than somewhere you came to see.
 */
const ENOUGH = 0.15;

export default function Globe({
  body,
  here,
  focus = null,
  onCentre = null,
  editing = false,
  onSaved = null,
  onDirty = null,
  journey = null,
}) {
  const standing = body?.standing || [];
  const tree = useMemo(() => treeOf(standing), [standing]);
  const { byId } = tree;
  const viewport = useViewport(body, focus, byId);
  const { view, k, near, origin, perPixel } = viewport;
  const editor = useShapeEditor({ body, tree, editing, onSaved, onDirty });
  const { chosen, draft, rides, total, tool } = editor;
  const { press, move, lift, spaced } = useGestures({ viewport, editor, editing, body });
  const [shown, flip] = useShown();
  const coarse = useMedia("(pointer: coarse)");
  const sun = body?.subsolar || null;

  const base = useMemo(
    () =>
      standing.flatMap((place) => {
        const read = runsOf(place.extent);
        if (!read) return [];
        const rings = read.runs.map(project);
        return [{ ...place, read, rings, box: boxOf(rings.flat()) }];
      }),
    [standing]
  );

  const marks = useMemo(() => {
    const moving = standing.map((place) => {
      const by = rides(place.id) || (place.id === chosen ? total : null);
      if (!by || place.lat === null || place.lon === null) return place;
      const [lon, lat] = carriedTo(by, [place.lon, place.lat]);
      return { ...place, lon, lat };
    });
    const sizes = new Map(base.map((place) => [place.id, place.box]));
    return gather(resolve(treeOf(moving), sizes, k, chosen), here, k);
  }, [standing, base, here, k, rides, chosen, total]);

  // Ground first, then what runs across it, then what stands on it — so a house
  // is not painted over by the village holding it.
  const drawn = useMemo(() => {
    return base
      .filter((place) => place.id !== chosen)
      .map((place) => {
        const by = rides(place.id);
        const rings = by ? carried(place.read.runs, by).map(project) : place.rings;
        const depth = Math.min(tree.ancestors(place.id).length, 6);
        return { ...place, rings, box: by ? boxOf(rings.flat()) : place.box, depth };
      })
      .sort((a, b) => (LAYER[a.type] ?? 2) - (LAYER[b.type] ?? 2) || a.depth - b.depth);
  }, [base, tree, chosen, rides]);

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
      if (isRun(place.type)) continue;
      const { box } = place;
      const fills = Math.max(
        (box.maxX - box.minX) / view.w,
        (box.maxY - box.minY) / view.h
      );
      if (fills < ENOUGH) continue;
      if (!covers(place.rings, [x, y])) continue;
      const size = (box.maxX - box.minX) * (box.maxY - box.minY);
      if (!best || size < best.size) best = { id: place.id, size };
    }
    return best?.id ?? null;
  }, [drawn, view.x, view.y, view.w, view.h]);

  useEffect(() => {
    if (onCentre) onCentre(centred);
  }, [centred, onCentre]);

  // Where the adventurer is standing, which is the one thing on this map that is
  // not a place.
  const walker = useMemo(() => {
    const at = byId.get(here);
    return at && at.lat !== null && at.lon !== null ? at : null;
  }, [byId, here]);

  return (
    <>
    {editing && <ShapeBar editor={editor} />}

    <div className="globepane">
    <svg
      ref={viewport.svg}
      viewBox={`${view.x - origin.x} ${view.y - origin.y} ${view.w} ${view.h}`}
      className={`globesvg${editing ? ` editing ${tool}` : ""}${spaced ? " panning" : ""}`}
      preserveAspectRatio="xMidYMid slice"
      role="img"
      onPointerDown={press}
      onPointerMove={move}
      onPointerUp={lift}
      onPointerCancel={lift}
    >
      <rect x={-origin.x} y={-origin.y} width={W} height={H} className="globeday" />
      <Graticule tilt={body.tilt} origin={origin} near={near} />
      <Shapes drawn={drawn} origin={origin} perPixel={perPixel} />
      <Words drawn={drawn} origin={origin} view={view} near={near} perPixel={perPixel} />
      {shown.grid && perPixel !== null && <Ruled view={view} k={k} radius={body.radius} origin={origin} />}

      {/* Over the ground, not under it. Night that only darkens the sea leaves a
          continent lit at midnight, which is not a map of anything. */}
      {sun && shown.night && <Night sun={sun} origin={origin} />}
      {sun && shown.bodies && <Sun sun={sun} origin={origin} near={near} />}
      {draft && <Draft draft={draft} origin={origin} perPixel={perPixel} />}
      {sun && shown.bodies && <Moons sun={sun} overhead={body.overhead || []} origin={origin} near={near} />}
      <Trip journey={journey} walker={walker} origin={origin} near={near} />
      <Pins marks={marks} chosen={chosen} origin={origin} near={near} />

      {/* Last, so a corner is never hidden under the name of something else —
          a label that swallows the handle you are reaching for is a handle that
          does not work. */}
      {draft && editing && tool === "select" && (
        <Gizmo draft={draft} coarse={coarse} origin={origin} near={near} />
      )}
      {draft && editing && (
        <Handles draft={draft} tool={tool} picked={editor.picked} coarse={coarse} origin={origin} near={near} />
      )}
      {editor.pen && editor.pen.length > 1 && <Stroke pen={editor.pen} origin={origin} near={near} />}
    </svg>

    <Palettes editor={editor} editing={editing} shown={shown} flip={flip} />
    {editing && editor.taken && <EditPalette editor={editor} />}
    {editing && editor.asking && <RemoveDialog editor={editor} tree={tree} body={body} />}
    {perPixel !== null && <Scale perPixel={perPixel} />}
    {editing && <Notices editor={editor} byId={byId} />}
    </div>
    </>
  );
}
