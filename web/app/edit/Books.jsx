"use client";

import { useRef, useState } from "react";
import { Act, Section } from "../ui";
import Icon from "../icons";
import { Field, Pick, reader } from "./fields";
import { Tags } from "./Common";
import { RARITIES } from "../world";

export default function BooksEdit({ thing, draft, change }) {
  const [get, put] = reader(draft, change, "book", thing.book);
  const texts = draft.passages ?? (thing.passages || []).map((p) => p.text);
  const set = (next) => change("passages", next);
  const list = useRef(null);
  const [held, setHeld] = useState(null);
  const [asking, setAsking] = useState(null);

  const slot = (y) => {
    const boxes = [...(list.current?.querySelectorAll(":scope > .epassage") || [])];
    const at = boxes.findIndex((box) => {
      const r = box.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return at === -1 ? boxes.length : at;
  };

  const grab = (n) => (e) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setAsking(null);
    setHeld({ from: n, to: n });
  };
  const drag = (e) => held && setHeld({ ...held, to: slot(e.clientY) });
  const drop = () => {
    if (!held) return;
    const { from, to } = held;
    setHeld(null);
    const into = to > from ? to - 1 : to;
    if (into === from) return;
    const next = [...texts];
    const [moving] = next.splice(from, 1);
    next.splice(into, 0, moving);
    set(next);
  };

  return (
    <>
      <div className="efields">
        <Field label="author" value={get("author")} onChange={put("author")} />
        <Pick label="author entry" kind="people" value={get("author_id")} onChange={put("author_id")} />
        <Field label="written" value={get("written")} onChange={put("written")} />
        <Field label="rarity" kind="choice" options={RARITIES} value={get("rarity")} onChange={put("rarity")} />
      </div>
      <Section label="text">
        <div className="epassages" ref={list}>
          {texts.map((text, n) => (
            <div
              key={n}
              className={`epassage${held?.from === n ? " lifted" : ""}${
                held && held.to === n && held.from !== n && held.from !== n - 1 ? " before" : ""
              }${held && held.to === texts.length && n === texts.length - 1 && held.from !== n ? " after" : ""}`}
            >
              <div className="epasshead">
                <button
                  className="egrip"
                  title="drag to move"
                  aria-label={`move passage ${n + 1}`}
                  onPointerDown={grab(n)}
                  onPointerMove={drag}
                  onPointerUp={drop}
                  onPointerCancel={() => setHeld(null)}
                >
                  <Icon name="grip" size={14} />
                </button>
                <span className="cap">{n + 1}</span>
                {asking === n ? (
                  <span className="eask">
                    <Act className="gone" onClick={() => { setAsking(null); set(texts.filter((_, m) => m !== n)); }}>
                      remove
                    </Act>
                    <Act onClick={() => setAsking(null)}>keep</Act>
                  </span>
                ) : (
                  <button className="exout" title="remove passage" aria-label={`remove passage ${n + 1}`} onClick={() => setAsking(n)}>
                    <Icon name="cross" size={12} />
                  </button>
                )}
              </div>
              <Field kind="text" value={text} onChange={(v) => set(texts.map((t, m) => (m === n ? v : t)))} />
            </div>
          ))}
        </div>
        <Act onClick={() => set([...texts, ""])}>add passage</Act>
      </Section>
      <Tags thing={thing} draft={draft} change={change} />
    </>
  );
}
