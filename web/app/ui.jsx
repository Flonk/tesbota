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

export function Empty({ children = "nothing" }) {
  return <p className="empty">{children}</p>;
}

export function Note({ tone = "dim", children }) {
  return <p className={`hint hint-${tone}`}>{children}</p>;
}
