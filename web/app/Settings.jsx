"use client";

import { useState } from "react";
import { Btn, Cap, Overlay } from "./ui";

export default function Settings({ who, busy, onKill, onClose }) {
  const [asking, setAsking] = useState(false);

  return (
    <Overlay title="settings" onClose={onClose}>
      <div className="dbody">
        <Cap>the adventurer</Cap>
        <p className="cap dwho">{who || "nobody is walking"}</p>
        <div className="actions left">
          <Btn tone="bad" disabled={!!busy || !who} onClick={() => setAsking(true)}>
            kill adventurer
          </Btn>
        </div>
        <p className="body dnote">
          The world keeps everything it has been told. Only the one walking through it is new.
        </p>
      </div>

      {asking && (
        <Overlay title={`kill ${who}?`} onClose={() => setAsking(false)}>
          <div className="dbody">
            <p className="body dnote">
              {who} stops here. Their book closes and stays on the shelf, whatever they carried
              stays where they fell, and somebody else sets out in the same world with nothing.
              This cannot be undone.
            </p>
            <div className="actions">
              <Btn onClick={() => setAsking(false)}>cancel</Btn>
              <Btn
                tone="bad"
                disabled={!!busy}
                onClick={() => {
                  setAsking(false);
                  onClose();
                  onKill();
                }}
              >
                kill {who}
              </Btn>
            </div>
          </div>
        </Overlay>
      )}
    </Overlay>
  );
}
