"use client";

import { useState } from "react";
import { Btn, Bubble, Cap, Empty } from "./ui";

export default function Lore({ gap, chat = [], busy, blocked, onSay }) {
  const [text, setText] = useState("");
  return (
    <div className="lore">
      <Cap>{blocked ? "the world is silent here" : "nothing is being asked of you"}</Cap>
      {blocked && gap?.text && <p className="body ask">{gap.text}</p>}
      {chat.length === 0 && !blocked && <Empty>no words yet</Empty>}
      {chat.map((m, i) => (
        <Bubble who={m.role} key={i}>
          {m.text}
        </Bubble>
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
            <Btn
              tone="gold"
              onClick={async () => {
                const t = text;
                setText("");
                await onSay(t);
              }}
              disabled={!!busy || !text.trim()}
            >
              {busy === "say" ? "thinking…" : "send"}
            </Btn>
          </div>
        </>
      )}
    </div>
  );
}
