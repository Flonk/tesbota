"use client";

import { Cap, Crumb, Empty } from "./ui";

const WORDS = { done: "done", failed: "failed", abandoned: "let go" };

export default function Quests({ quests = [] }) {
  const active = quests.filter((q) => q.status === "active");
  const past = quests.filter((q) => q.status !== "active");

  return (
    <div>
      <Cap>ongoing</Cap>
      {active.length === 0 && <Empty />}
      {active.map((q) => (
        <div className="quest" key={q.id}>
          <div className="qtitle">{q.title}</div>
          <Crumb where={q.where} />
          {q.giver && <div className="qsub">set by {q.giver}</div>}
          {q.detail && <div className="qsub">{q.detail}</div>}
          <div className="cap">opened {q.at || q.opened}</div>
        </div>
      ))}

      {past.length > 0 && (
        <>
          <Cap>finished</Cap>
          {past.map((q) => (
            <div className="quest past" key={q.id}>
              <div className="qtitle">{q.title}</div>
              <Crumb where={q.where} />
              <div className="cap">
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
