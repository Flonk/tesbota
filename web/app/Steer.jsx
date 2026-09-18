"use client";

import { useEffect, useState } from "react";
import { Bubble, Btn, Composer, Empty, Thread } from "./ui";

export default function Steer({ note, past = [], busy, onNote }) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(0);
  const [sending, setSending] = useState(null);

  // A note is one thing, not a log, so what is in flight is the note you wrote
  // against the note the world is holding — and it is shown until they agree.
  useEffect(() => {
    if (sending !== null && (note || "") === sending) setSending(null);
  }, [note, sending]);
  const landing = sending !== null && (note || "") !== sending;

  const put = async (words) => {
    setSending(words);
    const went = await onNote(words);
    if (went && went.ok === false) setSending(null);
    return went;
  };

  return (
    <div className="chat steer">
      <Thread stick={sent}>
        {past.length === 0 && !note && !landing && (
          <Empty>you have not steered the game master yet</Empty>
        )}
        {past.map((entry) => (
          <Bubble who="you" at={entry.id} key={entry.id}>
            {entry.note}
          </Bubble>
        ))}
        {note && !landing && (
          <>
            <Bubble who="you" at="not read yet">
              {note}
            </Bubble>
            <div className="actions">
              <Btn onClick={() => put("")} disabled={!!busy}>
                take it back
              </Btn>
            </div>
          </>
        )}
        {landing && sending && (
          <Bubble who="you" at="sending…" pending>
            {sending}
          </Bubble>
        )}
        {landing && !sending && note && (
          <Bubble who="you" at="taking it back" pending>
            {note}
          </Bubble>
        )}
      </Thread>
      <Composer
        value={text}
        onChange={setText}
        busy={busy === "note" ? busy : null}
        label={note ? "replace" : "queue"}
        placeholder="steer the next turn — the adventurer never learns of it…"
        onSend={async () => {
          const words = text;
          setText("");
          setSent((n) => n + 1);
          await put(words);
        }}
      />
    </div>
  );
}
