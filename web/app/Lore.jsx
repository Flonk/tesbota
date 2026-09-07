"use client";

import { useState } from "react";
import { Bubble, Cap, Composer, Empty, Thread } from "./ui";

export default function Lore({ gap, chat = [], busy, blocked, onSay }) {
  const [text, setText] = useState("");
  return (
    <div className="chat lore">
      <Thread>
        {!blocked && <Cap>nothing is being asked of you</Cap>}
        {blocked && gap?.text && (
          <Bubble who="the world is silent here" at={gap.turn} tone="gap">
            {gap.text}
          </Bubble>
        )}
        {chat.length === 0 && !blocked && <Empty>no words yet</Empty>}
        {chat.map((m, i) => (
          <Bubble who={m.role} key={i}>
            {m.text}
          </Bubble>
        ))}
      </Thread>
      <Composer
        value={text}
        onChange={setText}
        busy={busy === "say" ? busy : null}
        disabled={!blocked}
        placeholder={
          blocked ? "talk it through…" : "the lore master is not waiting on anything"
        }
        onSend={async () => {
          const said = text;
          setText("");
          await onSay(said);
        }}
      />
    </div>
  );
}
