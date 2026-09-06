"use client";

const WORDS = { done: "done", failed: "failed", abandoned: "let go" };

function Place({ where }) {
  if (!where?.length) return null;
  return (
    <div className="qplace">
      {where.map((p, n) => (
        <span key={p.id || n}>
          {n > 0 && <span className="sep">›</span>}
          {p.name}
        </span>
      ))}
    </div>
  );
}

export default function Quests({ quests = [] }) {
  const active = quests.filter((q) => q.status === "active");
  const past = quests.filter((q) => q.status !== "active");

  return (
    <div>
      <h3>ongoing</h3>
      {active.length === 0 && <p className="empty">nothing</p>}
      {active.map((q) => (
        <div className="quest" key={q.id}>
          <div className="qtitle">{q.title}</div>
          <Place where={q.where} />
          {q.giver && <div className="qgiver">set by {q.giver}</div>}
          {q.detail && <div className="qdetail">{q.detail}</div>}
          <div className="qmeta">opened {q.at || q.opened}</div>
        </div>
      ))}

      {past.length > 0 && (
        <>
          <h3>finished</h3>
          {past.map((q) => (
            <div className="quest past" key={q.id}>
              <div className="qtitle">{q.title}</div>
              <Place where={q.where} />
              <div className="qmeta">
                {WORDS[q.status] || q.status}
                {q.closed_at || q.closed ? ` · ${q.closed_at || q.closed}` : ""}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
