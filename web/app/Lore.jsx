"use client";

import { useCallback, useEffect, useState } from "react";
import { Bubble, Cap, Composer, Empty, Thread, useEcho, Working } from "./ui";

/**
 * The silence, which is a conversation between you and the lore master.
 *
 * Who is holding it is not guessed from whether a request is in flight — the
 * machine says it. `arbiter` is your turn to write, `lore3` is theirs, and the
 * thread shows whichever of you it is.
 */
export default function Lore({ gap, chat = [], busy, blocked, answering, onSay }) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(0);
  const [queued, setQueued] = useState(null);
  const [echo, echoed, forget] = useEcho(chat);
  const open = blocked || answering;
  const working = answering || busy === "say" || echo.length > 0;

  const send = useCallback(
    async (words) => {
      const mark = echoed(words);
      const went = await onSay(words);
      if (went && went.ok === false) forget(mark);
      return went;
    },
    [echoed, forget, onSay]
  );

  useEffect(() => {
    if (working || queued === null) return;
    const waiting = queued;
    setQueued(null);
    send(waiting);
  }, [working, queued, send]);

  return (
    <div className="chat lore">
      <Thread stick={sent}>
        {!open && <Cap>nothing is being asked of you</Cap>}
        {open && gap?.text && (
          <Bubble who="the world is silent here" at={gap.turn} tone="gap">
            {gap.text}
          </Bubble>
        )}
        {chat.length === 0 && echo.length === 0 && !open && <Empty>no words yet</Empty>}
        {chat.map((m, i) => (
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
        {queued !== null && (
          <Bubble who="you" at="waiting its turn" pending>
            {queued}
          </Bubble>
        )}
      </Thread>
      <Composer
        value={text}
        onChange={setText}
        label={working ? "queue" : "send"}
        disabled={!open}
        placeholder={
          open ? "talk it through…" : "the lore master is not waiting on anything"
        }
        onSend={async () => {
          const words = text;
          setText("");
          setSent((n) => n + 1);
          if (working) setQueued((held) => (held ? `${held}\n\n${words}` : words));
          else {
            const went = await send(words);
            if (went && went.ok === false) setText(words);
          }
        }}
      />
    </div>
  );
}
