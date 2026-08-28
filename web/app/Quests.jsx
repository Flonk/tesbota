"use client";

const WORDS = { done: "done", failed: "failed", abandoned: "let go" };

export default function Quests({ quests = [], onClose }) {
  const active = quests.filter((q) => q.status === "active");
  const past = quests.filter((q) => q.status !== "active");

  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheethead">
          <h2>what you have taken on</h2>
          <button className="ghost" onClick={onClose}>close</button>
        </div>

        <h3>ongoing</h3>
        {active.length === 0 && <p className="empty">nothing</p>}
        {active.map((q) => (
          <div className="quest" key={q.id}>
            <div className="qtitle">{q.title}</div>
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
                <div className="qmeta">
                  {WORDS[q.status] || q.status}
                  {q.closed_at || q.closed ? ` · ${q.closed_at || q.closed}` : ""}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
