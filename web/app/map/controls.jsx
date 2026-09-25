"use client";

import { useEffect, useState } from "react";
import { Act, Palette, Row } from "../ui";
import { TOOLS, UNWRITTEN } from "./editor";
import { LAYER } from "./layers";

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

export function useShown() {
  const [shown, setShown] = useState({ bodies: true, night: true, grid: false });

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

  return [shown, flip];
}

export function ShapeBar({ editor }) {
  const { taken, naming, setNaming, draft, dirty, saving, tool } = editor;
  return (
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
                onChange={(e) => editor.widen(e.target.value === "" ? null : Number(e.target.value))}
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
              if (e.key === "Enter") editor.found();
              if (e.key === "Escape") setNaming(null);
            }}
          />
          <select
            className="gtool"
            value={naming.type}
            onChange={(e) => setNaming({ ...naming, type: e.target.value })}
          >
            {Object.keys(LAYER).map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
          <Act onClick={() => setNaming(null)}>cancel</Act>
          <Act className="keep" onClick={editor.found} disabled={!naming.name.trim()}>
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
  );
}

export function Palettes({ editor, editing, shown, flip }) {
  return (
    <div className="palettes">
      {editing && <Palette items={TOOLS} value={editor.tool} onChange={editor.pickTool} />}
      <Palette items={VIEWS.map((v) => ({ ...v, on: shown[v.id], onClick: () => flip(v.id) }))} />
    </div>
  );
}

export function EditPalette({ editor }) {
  const { riders, bringing, past, future, dirty, saving, chosen, taken } = editor;
  return (
    <Palette
      across
      items={[
        ...(riders.size > 0
          ? [{
              id: "carry", icon: "stack", on: bringing,
              label: `carry ${riders.size} subplaces`,
              onClick: editor.bring,
            }]
          : []),
        { id: "undo", icon: "undo", label: "undo", hint: "ctrl Z", off: !past.length || saving, onClick: editor.undo },
        { id: "redo", icon: "redo", label: "redo", hint: "ctrl shift Z", off: !future.length || saving, onClick: editor.redo },
        { id: "revert", icon: "revert", label: "revert", off: !dirty || saving, onClick: editor.revert },
        ...(chosen !== UNWRITTEN
          ? [{
              id: "remove", icon: "trash", label: "remove", tone: "gone", off: saving,
              onClick: () => editor.setAsking({ id: taken.id, name: taken.name, deep: false }),
            }]
          : []),
        { id: "deselect", icon: "cross", label: "deselect", hint: "esc", off: saving, onClick: editor.release },
        { id: "save", icon: "check", label: "save", hint: "enter", tone: "keep", off: !dirty || saving, onClick: editor.keep },
      ]}
    />
  );
}

export function RemoveDialog({ editor, tree, body }) {
  const { asking, setAsking, saving, wrong } = editor;
  const inside = tree.descendants(asking.id);
  const going = asking.deep ? inside.length + 1 : 1;
  const up = tree.byId.get(asking.id)?.parent;
  const upName = tree.byId.get(up)?.name || body?.name || "the world";
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
          <Act className="gone" onClick={editor.remove} disabled={saving}>
            {saving ? "…" : `remove ${going} ${going === 1 ? "place" : "places"}`}
          </Act>
        </div>
      </div>
    </div>
  );
}

export function Notices({ editor, byId }) {
  const { asking, wrong, setWrong, movedNote, setMovedNote } = editor;
  if (!asking && wrong) {
    return (
      <div className="globewrong" onClick={() => setWrong(null)}>
        {wrong}
      </div>
    );
  }
  if (wrong || !movedNote) return null;
  return (
    <div className="globemoved" onClick={() => setMovedNote(null)}>
      moved {movedNote.length}: {movedNote.slice(0, 4).map((m) => byId.get(m.id)?.name || m.id).join(", ")}
      {movedNote.length > 4 ? " …" : ""}
    </div>
  );
}
