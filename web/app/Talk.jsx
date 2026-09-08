"use client";

import { useState } from "react";
import { Bubble, Composer, Empty, Thread } from "./ui";

export default function Talk({ said = [], busy, onSay }) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(0);

  return (
    <div className="chat lore">
      <Thread stick={sent}>
        {said.length === 0 && <Empty>the lore master is here whenever you are</Empty>}
        {said.map((m, i) => (
          <Bubble who={m.role} key={i}>
            {m.text}
          </Bubble>
        ))}
      </Thread>
      <Composer
        value={text}
        onChange={setText}
        busy={busy === "talk" ? busy : null}
        placeholder="talk about the world — they can write while you do…"
        onSend={async () => {
          const said = text;
          setText("");
          setSent((n) => n + 1);
          await onSay(said);
        }}
      />
    </div>
  );
}
