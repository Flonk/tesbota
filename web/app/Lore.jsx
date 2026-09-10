"use client";

import { useEffect, useState } from "react";
import { Bubble, Cap, Composer, Empty, Thread } from "./ui";

export default function Lore({ gap, chat = [], busy, blocked, onSay }) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(0);
  const [queued, setQueued] = useState(null);
  const working = busy === "say";

  useEffect(() => {
    if (working || queued === null) return;
    const waiting = queued;
    setQueued(null);
    onSay(waiting);
  }, [working, queued, onSay]);
  return (
    <div className="chat lore">
      <Thread stick={sent}>
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
        {queued !== null && (
          <Bubble who="you" at="waiting its turn">
            {queued}
          </Bubble>
        )}
      </Thread>
      <Composer
        value={text}
        onChange={setText}
        label={working ? "queue" : "send"}
        disabled={!blocked}
        placeholder={
          blocked ? "talk it through…" : "the lore master is not waiting on anything"
        }
        onSend={async () => {
          const said = text;
          setText("");
          setSent((n) => n + 1);
          if (working) setQueued((held) => (held ? `${held}\n\n${said}` : said));
          else await onSay(said);
        }}
      />
    </div>
  );
}
