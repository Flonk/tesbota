"use client";

import { useState } from "react";

export default function Lore({ gap, chat = [], busy, blocked, onSay }) {
  const [text, setText] = useState("");
  return (
    <div className="lore">
      {blocked ? (
        <h2>the world is silent here</h2>
      ) : (
        <h2 className="quiet">nothing is being asked of you</h2>
      )}
      {blocked && gap?.text && <div className="gaptext">{gap.text}</div>}
      {chat.length === 0 && !blocked && <p className="empty">no words yet</p>}
      {chat.map((m, i) => (
        <div className={`bubble ${m.role === "you" ? "you" : ""}`} key={i}>
          <span className="who">{m.role}</span>
          {m.text}
        </div>
      ))}
      {blocked && (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="talk it through…"
            disabled={!!busy}
          />
          <div className="actions">
            <button
              onClick={async () => {
                const t = text;
                setText("");
                await onSay(t);
              }}
              disabled={!!busy || !text.trim()}
            >
              {busy === "say" ? "thinking…" : "send"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
