"use client";

import { useState } from "react";
import { Bubble, Btn, Composer, Empty, Thread } from "./ui";

export default function Steer({ note, past = [], busy, onNote }) {
  const [text, setText] = useState("");

  return (
    <div className="chat steer">
      <Thread>
        {past.length === 0 && !note && (
          <Empty>you have not steered the game master yet</Empty>
        )}
        {past.map((entry) => (
          <Bubble who="you" at={entry.id} key={entry.id}>
            {entry.note}
          </Bubble>
        ))}
        {note && (
          <>
            <Bubble who="you" at="not read yet">
              {note}
            </Bubble>
            <div className="actions">
              <Btn onClick={() => onNote("")} disabled={!!busy}>
                take it back
              </Btn>
            </div>
          </>
        )}
      </Thread>
      <Composer
        value={text}
        onChange={setText}
        busy={busy === "note" ? busy : null}
        label={note ? "replace" : "queue"}
        placeholder="steer the next turn — the adventurer never learns of it…"
        onSend={async () => {
          const queued = text;
          setText("");
          await onNote(queued);
        }}
      />
    </div>
  );
}
