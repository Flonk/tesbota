"use client";

import { useState } from "react";
import { Bubble, Composer, Empty, Thread, useEcho, Working } from "./ui";

export default function Talk({ said = [], busy, onSay }) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(0);
  const [echo, echoed, forget] = useEcho(said);
  const working = busy === "talk" || echo.length > 0;

  return (
    <div className="chat lore">
      <Thread stick={sent}>
        {said.length === 0 && echo.length === 0 && (
          <Empty>the lore master is here whenever you are</Empty>
        )}
        {said.map((m, i) => (
          <Bubble who={m.role} key={i}>
            {m.text}
          </Bubble>
        ))}
        {echo.map((e) => (
          <Bubble who="you" key={`echo-${e.mark}`} pending>
            {e.text}
          </Bubble>
        ))}
        {working && <Working who="lore master" />}
      </Thread>
      <Composer
        value={text}
        onChange={setText}
        busy={busy === "talk" ? busy : null}
        placeholder="talk about the world — they can write while you do…"
        onSend={async () => {
          const words = text;
          setText("");
          setSent((n) => n + 1);
          const mark = echoed(words);
          const went = await onSay(words);
          if (went && went.ok === false) {
            forget(mark);
            setText(words);
          }
        }}
      />
    </div>
  );
}
