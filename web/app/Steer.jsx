"use client";

import { useState } from "react";
import { Btn, Cap, Empty } from "./ui";

export default function Steer({ note, past = [], busy, onNote }) {
  const [text, setText] = useState("");

  return (
    <div className="lore steer">
      <Cap>{note ? "queued, waiting to be read" : "nothing queued"}</Cap>
      {note ? (
        <>
          <p className="body told queued">{note}</p>
          <div className="actions">
            <Btn onClick={() => onNote("")} disabled={!!busy}>
              take it back
            </Btn>
          </div>
        </>
      ) : (
        <Empty>the game master has no direction from you</Empty>
      )}

      {past.length > 0 && (
        <>
          <Cap>what you steered before</Cap>
          {past.map((entry) => (
            <div className="steered" key={entry.id}>
              <p className="cap">{entry.id}</p>
              <p className="body told">{entry.note}</p>
            </div>
          ))}
        </>
      )}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="say what should happen next — nobody in the story says it, and the adventurer never learns of it…"
        disabled={!!busy}
      />
      <div className="actions">
        <Btn
          tone="gold"
          onClick={async () => {
            const queued = text;
            setText("");
            await onNote(queued);
          }}
          disabled={!!busy || !text.trim()}
        >
          {busy === "note" ? "queueing…" : note ? "replace it" : "queue it"}
        </Btn>
      </div>
    </div>
  );
}
