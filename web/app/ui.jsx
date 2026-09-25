"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "./icons";

export function Btn({ tone = "plain", className = "", ...rest }) {
  return <button className={`btn btn-${tone} ${className}`.trim()} {...rest} />;
}

// Tag is a verdict. Pill is a name. Mark is an icon with its words.
export function Tag({ tone = "dim", children }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

export function Pill({ on, onClick, title, className = "", children }) {
  const look = `toggle pill${on ? " on" : ""}${onClick ? "" : " flat"} ${className}`.trim();
  if (!onClick) {
    return (
      <span className={look} title={title}>
        {children}
      </span>
    );
  }
  return (
    <button className={look} title={title} onClick={onClick}>
      {children}
    </button>
  );
}

export function Mark({ name, size, title, tone, gap, className = "", children }) {
  return (
    <span
      className={`mark ${className}`.trim()}
      title={title}
      style={gap ? { "--gap": gap } : undefined}
    >
      {name && (
        <span className={`markface ${tone || ""}`.trim()}>
          <Icon name={name} size={size} />
        </span>
      )}
      {children}
    </span>
  );
}

export function Cap({ children }) {
  return <div className="cap">{children}</div>;
}

export function Section({ label, children }) {
  return (
    <div className="dsec">
      {label && <p className="cap">{label}</p>}
      {children}
    </div>
  );
}

export function Crumb({ where = [], short = false, lead = null, onPick = null, className = "" }) {
  if (!where.length) return null;
  const shown = short ? where.slice(-2) : where;
  return (
    <div className={`crumb ${className}`.trim()}>
      {lead}
      {short && where.length > shown.length && (
        <span className="sep" title={where.map((p) => p.name).join(" › ")}>
          …›
        </span>
      )}
      {shown.map((p, n) => (
        <span key={p.id || n}>
          {n > 0 && <span className="sep">›</span>}
          {p.id ? (
            <button className="dlink" onClick={() => (onPick ? onPick(p.id) : openDossier(p.id))}>
              {p.name}
            </button>
          ) : (
            p.name
          )}
        </span>
      ))}
    </div>
  );
}

export function Fold({ label, open, className = "", children }) {
  return (
    <details className={`sec sec-fold-box ${className}`.trim()} open={open}>
      <summary className="sec-label">{label}</summary>
      <div className="sec-fold">{children}</div>
    </details>
  );
}

export function Block({ label, kind, children }) {
  return (
    <div className={`sec sec-block${kind ? ` sec-${kind}` : ""}`}>
      <p className="sec-label">{label}</p>
      <div className="sec-fold">{children}</div>
    </div>
  );
}

export function Meter({ label, value, max, tone }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <span className="meter" title={`${label} ${value}/${max}`}>
      <span className="meterlabel">{label}</span>
      <span className="metertrack">
        <span className={`meterfill ${tone}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="meternum">{value}</span>
    </span>
  );
}

export function Bubble({ who, at, tone, pending, children }) {
  return (
    <div
      className={`bubble${who === "you" ? " you" : ""}${tone ? ` bubble-${tone}` : ""}${
        pending ? " sending" : ""
      }`}
    >
      <span className="who">
        {who}
        {at && <span className="when">{at}</span>}
      </span>
      <div className="msg">{children}</div>
    </div>
  );
}

/** Somebody is composing an answer. Every chat says it the same way. */
export function Working({ who }) {
  return (
    <div className="bubble working">
      <span className="who">{who}</span>
      <div className="msg">
        <span className="dots" aria-label="writing">
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  );
}

/**
 * What you just said, held in front of you until the world hands it back.
 *
 * Every message makes a round trip through a file on disk and a poll before it
 * comes back as part of the log, which is seconds at best. Showing it the moment
 * you send it is the difference between a chat and a form. An echo is counted out
 * rather than matched on its words, so saying the same thing twice still shows
 * twice, and it is dropped the moment the log is that much longer than it was.
 */
export function useEcho(log) {
  const [echo, setEcho] = useState([]);
  const next = useRef(0);
  const mine = log.filter((m) => m.role === "you").length;

  useEffect(() => {
    setEcho((held) => {
      const left = held.filter((e) => mine < e.want);
      return left.length === held.length ? held : left;
    });
  }, [mine]);

  const echoed = useCallback(
    (text) => {
      const mark = (next.current += 1);
      setEcho((held) => [...held, { mark, text, want: mine + held.length + 1 }]);
      return mark;
    },
    [mine]
  );

  // A send the world would not take never becomes a message, so its echo has to
  // go — otherwise it sits there greyed out forever looking like it is on its way.
  const forget = useCallback(
    (mark) => setEcho((held) => held.filter((e) => e.mark !== mark)),
    []
  );
  return [echo, echoed, forget];
}

export function Thread({ stick, children }) {
  const box = useRef(null);
  const pinned = useRef(true);
  const tall = useRef(0);

  useEffect(() => {
    pinned.current = true;
  }, [stick]);

  useEffect(() => {
    const el = box.current;
    if (!el || el.scrollHeight === tall.current) return;
    tall.current = el.scrollHeight;
    if (pinned.current) el.scrollTop = el.scrollHeight;
  });

  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  return (
    <div
      className="thread"
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      }}
    >
      {children}
    </div>
  );
}

export function Composer({
  value,
  onChange,
  onSend,
  placeholder,
  disabled,
  label = "send",
  busy,
}) {
  const ready = !disabled && !busy && value.trim();
  return (
    <div className={`composer${disabled ? " shut" : ""}`}>
      <textarea
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (ready) onSend();
          }
        }}
        placeholder={placeholder}
        disabled={disabled || !!busy}
      />
      <button className="sendbtn" onClick={onSend} disabled={!ready}>
        {busy ? "…" : label}
      </button>
    </div>
  );
}

/**
  * A bar: one row of controls under a heading or above a panel.
  *
  * Every such row in this app is one of these, so they are all the same height
  * with the same air at the sides and the same rule underneath. Nothing that sits
  * in a bar sets its own padding — if a row needs to be taller, `--bar-h` moves
  * every row at once, which is the only way they stay agreeing with each other.
  */
export function Row({
  as: Tag = "div", pad = true, ruled = true, middled = true, className = "", children, ...rest
}) {
  const look = [
    "row",
    pad && "pad",
    ruled && "ruled",
    middled && "middled",
    className,
  ].filter(Boolean).join(" ");
  return <Tag className={look} {...rest}>{children}</Tag>;
}

/** A button that lives in a bar and does something, as against a tab that picks. */
export function Act({ on, className = "", type = "button", ...rest }) {
  return <button type={type} className={`gtool${on ? " on" : ""} ${className}`.trim()} {...rest} />;
}

export function Pen({ on, onClick, title }) {
  return (
    <button type="button" className={`crumbtool${on ? " on" : ""}`} onClick={onClick} title={title} aria-label="edit">
      <Icon name="pen" size={14} />
    </button>
  );
}

export function EditBar({ dirty, note, saving, onCancel, onSave }) {
  return (
    <Row>
      <span className="gname dim">
        editing
        {dirty && <span className="gdirty" title="unsaved changes">•</span>}
        {note && <span className="gdirty">{note}</span>}
      </span>
      <Act onClick={onCancel} disabled={saving} title="cancel (esc)">
        cancel
      </Act>
      <Act className="keep" onClick={onSave} disabled={!dirty || saving} title="save (ctrl enter)">
        {saving ? "…" : "save"}
      </Act>
    </Row>
  );
}

export function Palette({ items, value, onChange, across = false, className = "" }) {
  return (
    <div className={`palette${across ? " across" : ""} ${className}`.trim()} role="toolbar">
      {items.map((t) => {
        const on = t.on ?? (value !== undefined && value === t.id);
        const hint = t.hint || t.key?.toUpperCase();
        return (
          <button
            key={t.id}
            className={`tab${on ? " on" : ""}${t.tone ? ` ${t.tone}` : ""}`}
            title={hint ? `${t.label} (${hint})` : t.label}
            aria-label={t.label}
            aria-pressed={t.onClick && t.on === undefined ? undefined : on}
            disabled={t.off || undefined}
            onClick={() => (t.onClick ? t.onClick() : onChange(t.id))}
          >
            <Icon name={t.icon} size={15} />
          </button>
        );
      })}
    </div>
  );
}

export function Tabs({ items, value, onChange, sub = false, className = "" }) {
  return (
    <div className={`tabs${sub ? " sub pad ruled" : ""} ${className}`.trim()}>
      {items.map((t) => (
        <button
          key={t.id}
          className={`tab${value === t.id ? " on" : ""}`}
          onClick={() => onChange(t.id)}
        >
          <Mark name={t.icon}>{t.label}</Mark>
          {t.pip && <span className="pip" />}
          {t.count > 0 && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** For a table whose rows carry a rarity: colour each by its own. */
export const rated = (row) => row?.rarity ?? null;
/** For a table whose rows have no rarity to speak of. Saying so is still required. */
export const unrated = () => null;

export const tint = (rarity) => (rarity && rarity !== "common" ? `tint-${rarity}` : "");

export function Table({
  cols,
  fields,
  rows,
  rarity,
  sort,
  onSort,
  selected,
  onOpen,
  rowClass,
  empty = "nothing",
}) {
  if (typeof rarity !== "function") {
    throw new Error("Table needs rarity={(row) => rarity}: pass rated, unrated, or your own");
  }
  const heads = fields.some((f) => f.label);
  if (!rows.length && !heads) return <Empty>{empty}</Empty>;
  return (
    <div className="etable" style={{ "--cols": cols }}>
      {heads && (
        <div className="erow ehead">
          {fields.map((f) =>
            onSort ? (
              <button
                key={f.key}
                className={`ecol${f.num ? " num" : ""}${sort?.key === f.key ? " on" : ""}`}
                onClick={() => onSort(f.key)}
              >
                {f.label}
                {sort?.key === f.key && <span className="dir">{sort.dir > 0 ? "↑" : "↓"}</span>}
              </button>
            ) : (
              <span key={f.key} className={`ecol${f.num ? " num" : ""}`}>
                {f.label}
              </span>
            )
          )}
        </div>
      )}
      {!rows.length && <Empty>{empty}</Empty>}
      {rows.map((r, n) => {
        const id = r.id ?? n;
        const lit = selected != null && id === selected;
        return (
          <div
            key={id}
            data-sel={lit ? "1" : undefined}
            title={typeof r.id === "string" ? r.id : undefined}
            className={`erow${onOpen ? " pick" : ""}${rowClass ? ` ${rowClass(r)}` : ""}${
              lit ? " sel" : ""
            }`}
            onClick={onOpen ? () => onOpen(id) : undefined}
          >
            {fields.map((f) => (
              <span
                key={f.key}
                className={`ecell${f.num ? " num" : ""}${f.dim ? " dim" : ""}${
                  f.strong ? ` ename ${tint(rarity(r))}` : ""
                }`}
              >
                {f.cell(r)}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}

export function Overlay({ title, tags, face, tone, under, copy, onClose, tools, bar, onEscape, holding, children }) {
  const panel = useRef(null);
  useEffect(() => {
    function key(e) {
      if (e.key !== "Escape") return;
      if (onEscape) onEscape();
      else onClose();
    }
    function away(e) {
      if (holding) return;
      if (panel.current && !panel.current.contains(e.target)) onClose();
    }
    document.addEventListener("keydown", key);
    document.addEventListener("mousedown", away);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("mousedown", away);
    };
  }, [onClose, onEscape, holding]);

  return (
    <div className="dossier">
      <div className="dpanel" ref={panel}>
        <div className="dhead">
          {face &&
            (copy ? (
              <button
                className="dface"
                title={`copy ${copy}`}
                onClick={() => navigator.clipboard?.writeText(copy).catch(() => {})}
              >
                <Icon name={face} size={22} />
              </button>
            ) : (
              <Icon name={face} size={34} />
            ))}
          <div className="dtitle">
            <span className={`dname ${tone || ""}`}>
              {title}
              {tags}
            </span>
            {under}
          </div>
          {tools}
          <button className="dclose" onClick={onClose} title="close">
            ×
          </button>
        </div>
        {bar}
        <div className="dpad">{children}</div>
      </div>
    </div>
  );
}

export function Stub() {
  return (
    <span className="stubmark" title="left deliberately unwritten — the world will come back to it">
      $BOTA
    </span>
  );
}

export const unwritten = (v) => !String(v ?? "").trim() || String(v).includes("$BOTA");
export const settled = (v) => (unwritten(v) ? "" : String(v).trim());
export const told = (v) => (unwritten(v) ? <Stub /> : String(v).trim());

export function Empty({ children = "nothing" }) {
  return <p className="empty">{children}</p>;
}

export function Note({ tone = "dim", children }) {
  return <p className={`hint hint-${tone}`}>{children}</p>;
}

const ADDRESS =
  /\[([^\]]*)\]\((bota:\/\/[^)\s]+)\)|(bota:\/\/[A-Za-z]+\/[A-Za-z0-9][A-Za-z0-9-]*(?:#[pc]\d+)?)|(<<[^>]*>>)|(\$BOTA)/g;

let NAMES = null;

export function knowNames(index) {
  NAMES = index || {};
}

const KINDS = {
  people: "people", person: "people",
  places: "places", place: "places",
  books: "books", book: "books",
  items: "items", item: "items",
  aspects: "aspects", aspect: "aspects",
  abilities: "abilities", ability: "abilities",
};

function target(address) {
  const found = /^bota:\/\/([A-Za-z]+)\/([A-Za-z0-9][A-Za-z0-9-]*)(?:#([pc]\d+))?$/.exec(
    String(address || "")
  );
  const kind = found && KINDS[found[1].toLowerCase()];
  return kind ? { kind, id: found[2].toLowerCase(), fragment: found[3] || null } : null;
}

export function openDossier(id, fragment = null) {
  if (id) window.dispatchEvent(new CustomEvent("bota:open", { detail: { id: String(id), fragment } }));
}

export function openMap(id) {
  if (id) window.dispatchEvent(new CustomEvent("bota:map", { detail: { id: String(id) } }));
}

function Link({ at, label, raw }) {
  const known = !NAMES || !!NAMES[at.id];
  return (
    <button
      className={`dlink${known ? "" : " dangling"}`}
      title={known ? raw : `${raw} — nobody has written this`}
      onClick={() => openDossier(at.id, at.fragment)}
    >
      {label}
    </button>
  );
}

export function Prose({ text, className = "", as: As = "p" }) {
  const src = String(text || "");
  const out = [];
  let last = 0;
  for (const m of src.matchAll(ADDRESS)) {
    if (m.index > last) out.push(src.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[5]) {
      out.push(<Stub key={last} />);
      continue;
    }
    if (m[4]) {
      out.push(<mark key={last}>{m[4].slice(2, -2)}</mark>);
      continue;
    }
    const raw = m[2] || m[3];
    const at = target(raw);
    if (!at) {
      out.push(raw);
      continue;
    }
    const label = m[1] || NAMES?.[at.id]?.name || at.id.replace(/-/g, " ");
    out.push(<Link key={last} at={at} label={label} raw={raw} />);
  }
  out.push(src.slice(last));
  return (
    <As className={className}>
      {out.map((piece, n) => (typeof piece === "string" ? <span key={n}>{piece}</span> : piece))}
    </As>
  );
}
