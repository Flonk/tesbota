"use client";

import { useState } from "react";
import { Bubble, Btn, Cap, Composer, Empty, Thread } from "./ui";

export default function Steer({ note, past = [], busy, onNote }) {
  const [text, setText] = useState("");

  return (
    <div className="chat steer">
      <Thread>
        {past.length === 0 && !note && (
          <Empty>you have not steered the game master yet</Empty>
        )}
        {past.map((entry) => (
          <Bubble who="you" key={entry.id}>
            {entry.note}
          </Bubble>
        ))}
        {note && (
          <>
            <Cap>queued, waiting to be read</Cap>
            <Bubble who="you">{note}</Bubble>
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
        placeholder="say what should happen next — the adventurer never learns of it…"
        onSend={async () => {
          const queued = text;
          setText("");
          await onNote(queued);
        }}
      />
    </div>
  );
}
