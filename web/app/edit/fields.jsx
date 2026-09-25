"use client";

import { useEffect, useId, useState } from "react";
import { Act, Section } from "../ui";

const shown = (value) => (value === null || value === undefined ? "" : String(value));

export function Field({ label, value, onChange, kind = "line", options = [], placeholder = "", wide = false }) {
  const id = useId();
  let input;
  if (kind === "text") {
    input = (
      <textarea
        id={id}
        className="einput etext"
        value={shown(value)}
        placeholder={placeholder}
        rows={Math.max(3, shown(value).split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 70)), 0) + 1)}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  } else if (kind === "choice") {
    input = (
      <select id={id} className="einput" value={shown(value)} onChange={(e) => onChange(e.target.value || null)}>
        <option value="" />
        {options.map((o) => {
          const [v, l] = Array.isArray(o) ? o : [o, o];
          return (
            <option key={v} value={v}>
              {l}
            </option>
          );
        })}
      </select>
    );
  } else if (kind === "number") {
    input = (
      <input
        id={id}
        className="einput"
        type="number"
        step="any"
        value={shown(value)}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      />
    );
  } else {
    input = (
      <input
        id={id}
        className="einput"
        value={shown(value)}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  if (!label) return input;
  return (
    <div className={`efield${wide || kind === "text" ? " wide" : ""}`}>
      <label className="cap" htmlFor={id}>
        {label}
      </label>
      {input}
    </div>
  );
}

const known = {};
const asked = {};

/** Forget every list of names, for after an edit that may have changed one. */
export function forget() {
  for (const kind of Object.keys(known)) delete known[kind];
  for (const kind of Object.keys(asked)) delete asked[kind];
}

function ask(kind) {
  if (!asked[kind]) {
    asked[kind] = fetch(`/api/entities?kind=${encodeURIComponent(kind)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((got) => (known[kind] = Array.isArray(got) ? got : []))
      .catch(() => {
        delete asked[kind];
        return [];
      });
  }
  return asked[kind];
}

/** Everything of one kind, by name, fetched once and shared by every field that asks. */
export function useKind(kind) {
  const [rows, setRows] = useState(known[kind] || null);
  useEffect(() => {
    if (!kind) return;
    if (known[kind]) {
      setRows(known[kind]);
      return;
    }
    let live = true;
    ask(kind).then((got) => live && setRows(got));
    return () => {
      live = false;
    };
  }, [kind]);
  return rows || [];
}

/**
 * An entity of one kind, chosen by name. What is typed is matched against the
 * names and ids of that kind; the value is always the id, or `$BOTA`, or null.
 */
export function Pick({ label, kind, value, onChange, placeholder = "" }) {
  const rows = useKind(kind);
  const list = useId();
  const id = useId();
  const nameOf = (v) => rows.find((r) => r.id === v)?.name ?? v ?? "";
  const [text, setText] = useState(nameOf(value));
  useEffect(() => {
    setText(nameOf(value));
  }, [value, rows.length]);
  const known_one = (t) => {
    const want = t.trim().toLowerCase();
    if (!want) return null;
    if (want === "$bota") return "$BOTA";
    const hit = rows.find((r) => r.name.toLowerCase() === want || r.id === want);
    return hit ? hit.id : undefined;
  };
  const got = known_one(text);
  const input = (
    <>
      <input
        id={id}
        className={`einput${got === undefined ? " bad" : ""}`}
        list={list}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          const hit = known_one(e.target.value);
          if (hit !== undefined) onChange(hit);
        }}
        onBlur={() => {
          if (known_one(text) === undefined) setText(nameOf(value));
        }}
      />
      <datalist id={list}>
        {rows.map((r) => (
          <option key={r.id} value={r.name} />
        ))}
      </datalist>
    </>
  );
  if (!label) return input;
  return (
    <div className="efield">
      <label className="cap" htmlFor={id}>
        {label}
      </label>
      {input}
    </div>
  );
}

/**
 * A list of rows, each a line of fields, with a way to add one and take any away.
 * `columns` are `{ key, label, kind, options, pick }` — `pick` names the kind an
 * entity column chooses from.
 */
export function Many({ label, rows, onChange, columns, blank, empty = "none" }) {
  const set = (n, key, v) => onChange(rows.map((row, m) => (m === n ? { ...row, [key]: v } : row)));
  return (
    <Section label={label}>
      <div className="emany" style={{ "--cols": columns.length }}>
        {rows.length > 0 && (
          <div className="erow ehead">
            {columns.map((c) => (
              <span key={c.key} className="cap">
                {c.label}
              </span>
            ))}
            <span />
          </div>
        )}
        {rows.length === 0 && <p className="empty">{empty}</p>}
        {rows.map((row, n) => (
          <div className="erow" key={n}>
            {columns.map((c) =>
              c.pick ? (
                <Pick key={c.key} kind={c.pick} value={row[c.key]} onChange={(v) => set(n, c.key, v)} />
              ) : (
                <Field
                  key={c.key}
                  kind={c.kind}
                  options={c.options}
                  value={row[c.key]}
                  onChange={(v) => set(n, c.key, v)}
                />
              )
            )}
            <Act onClick={() => onChange(rows.filter((_, m) => m !== n))} title="remove">
              ×
            </Act>
          </div>
        ))}
      </div>
      <Act onClick={() => onChange([...rows, { ...blank }])}>add</Act>
    </Section>
  );
}

/** A list of words, like a person's traits. */
export function Chips({ label, values, onChange, placeholder = "add" }) {
  const [text, setText] = useState("");
  const add = () => {
    const words = text.split(",").map((w) => w.trim()).filter(Boolean);
    if (words.length) onChange([...values, ...words.filter((w) => !values.includes(w))]);
    setText("");
  };
  return (
    <Section label={label}>
      <div className="dtraits echips">
        {values.map((v) => (
          <span className="pill echip" key={v}>
            {v}
            <button onClick={() => onChange(values.filter((w) => w !== v))} title="remove" aria-label={`remove ${v}`}>
              ×
            </button>
          </span>
        ))}
        <input
          className="einput echipin"
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
        />
      </div>
    </Section>
  );
}

/** The fields of one object section, read from the draft first and the record second. */
export function reader(draft, change, section, saved) {
  const get = (key) => (draft[section] && key in draft[section] ? draft[section][key] : saved?.[key] ?? null);
  const put = (key) => (v) => change(section, { [key]: v });
  return [get, put];
}
