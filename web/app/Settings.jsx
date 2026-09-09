"use client";

import { useEffect, useState } from "react";
import { Btn, Cap, Overlay } from "./ui";

const STEPS = [1, 5, 10, 30, 60, 120, 300, 600, 1200, 3000, 6000, 12000, 20000];

const nearest = (factor) =>
  STEPS.reduce((best, n, i) => (Math.abs(n - factor) < Math.abs(STEPS[best] - factor) ? i : best), 0);

function pace(factor) {
  const seconds = 3600 / factor;
  if (seconds >= 3600) return `an hour of world time takes ${Math.round(seconds / 3600)}h`;
  if (seconds >= 60) return `an hour of world time takes ${Math.round(seconds / 60)} min`;
  return `an hour of world time takes ${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
}

export default function Settings({ who, speed, paused, busy, onKill, onSpeed, onPause, onClose }) {
  const [asking, setAsking] = useState(false);
  const [at, setAt] = useState(nearest(speed || 6000));

  useEffect(() => {
    if (speed) setAt(nearest(speed));
  }, [speed]);

  return (
    <Overlay title="settings" onClose={onClose}>
      <div className="dbody">
        <Cap>the adventurer</Cap>
        <p className="cap dwho">{who || "nobody is walking"}</p>
        <div className="actions left">
          <Btn tone={paused ? "gold" : "plain"} disabled={busy === "pause"} onClick={() => onPause(!paused)}>
            {paused ? "let it run" : "pause"}
          </Btn>
          <Btn tone="bad" disabled={!!busy || !who} onClick={() => setAsking(true)}>
            kill adventurer
          </Btn>
        </div>
        <p className="body dnote">
          Paused, no step runs — the clock stops turning the world over until you let it go.
          Nothing in flight is lost.
        </p>

        <Cap>game speed</Cap>
        <p className="cap dwho">
          {STEPS[at]} — {pace(STEPS[at])}
        </p>
        <input
          className="dial"
          type="range"
          min={0}
          max={STEPS.length - 1}
          step={1}
          value={at}
          onChange={(e) => setAt(Number(e.target.value))}
          onPointerUp={() => onSpeed(STEPS[at])}
          onKeyUp={() => onSpeed(STEPS[at])}
        />
        <p className="body dnote">
          How many minutes of world time pass in a minute of ours. 1 is real time; the
          prototype runs in the thousands so a day's walk is not a day's wait.
        </p>
      </div>

      {asking && (
        <Overlay title={`kill ${who}?`} onClose={() => setAsking(false)}>
          <div className="dbody">
            <p className="body dnote">
              {who} stops here, dead of a mysterious cause — the last line of their book, since
              the godhead does not explain itself. Whatever they carried stays where they fell,
              the book stays on the shelf, and somebody else sets out in the same world with
              nothing. This cannot be undone.
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
