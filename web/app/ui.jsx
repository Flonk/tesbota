"use client";

export function Btn({ tone = "plain", className = "", ...rest }) {
  return <button className={`btn btn-${tone} ${className}`.trim()} {...rest} />;
}

export function Tag({ tone = "dim", children }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

export function Cap({ children }) {
  return <div className="cap">{children}</div>;
}

export function Crumb({ where = [], className = "" }) {
  if (!where.length) return null;
  return (
    <div className={`crumb ${className}`.trim()}>
      {where.map((p, n) => (
        <span key={p.id || n}>
          {n > 0 && <span className="sep">›</span>}
          {p.name}
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

export function Bar({ label, value, max, tone }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <span className="bar" title={`${label} ${value}/${max}`}>
      <span className="barlabel">{label}</span>
      <span className="bartrack">
        <span className={`barfill ${tone}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="barnum">{value}</span>
    </span>
  );
}

export function Bubble({ who, children }) {
  return (
    <div className={`bubble${who === "you" ? " you" : ""}`}>
      <span className="who">{who}</span>
      {children}
    </div>
  );
}

export function Tabs({ items, value, onChange, className = "" }) {
  return (
    <div className={`tabs ${className}`.trim()}>
      {items.map((t) => (
        <button
          key={t.id}
          className={`tab${value === t.id ? " on" : ""}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.pip && <span className="pip" />}
          {t.count > 0 && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Table({
  cols,
  fields,
  rows,
  sort,
  onSort,
  selected,
  onOpen,
  rowClass,
  empty = "nothing",
}) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  const heads = fields.some((f) => f.label);
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
                  f.strong ? " ename" : ""
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

export function Toggle({ on, onClick, className = "", children }) {
  return (
    <button className={`toggle${on ? " on" : ""} ${className}`.trim()} onClick={onClick}>
      {children}
    </button>
  );
}

export function Empty({ children = "nothing" }) {
  return <p className="empty">{children}</p>;
}

export function Note({ tone = "dim", children }) {
  return <p className={`hint hint-${tone}`}>{children}</p>;
}

const ADDRESS =
  /\[([^\]]*)\]\((bota:\/\/[^)\s]+)\)|(bota:\/\/[a-z]+\/[a-z0-9][a-z0-9-]*(?:#[pc]\d+)?)|(<<[^>]*>>)|(\$BOTA)/g;

let NAMES = null;

export function knowNames(index) {
  NAMES = index || {};
}

export function target(address) {
  const found = /^bota:\/\/(people|places|books|items)\/([a-z0-9][a-z0-9-]*)(?:#([pc]\d+))?$/.exec(
    String(address || "")
  );
  return found ? { kind: found[1], id: found[2], fragment: found[3] || null } : null;
}

export function openDossier(id, fragment = null) {
  if (id) window.dispatchEvent(new CustomEvent("bota:open", { detail: { id: String(id), fragment } }));
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
      out.push(
        <span className="stubmark" key={last} title="somebody left this deliberately unwritten">
          nobody has written this yet
        </span>
      );
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
    const label = m[1] || NAMES?.[at.id]?.name || raw;
    out.push(<Link key={last} at={at} label={label} raw={raw} />);
  }
  out.push(src.slice(last));
  return (
    <As className={className}>
      {out.map((piece, n) => (typeof piece === "string" ? <span key={n}>{piece}</span> : piece))}
    </As>
  );
}
