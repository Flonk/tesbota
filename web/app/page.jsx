"use client";

import { useCallback, useEffect, useRef, useState } from "react";

function Bar({ label, value, max, tone }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <span className="bar" title={`${label} ${value}/${max}`}>
      <span className="barlabel">{label}</span>
      <span className="bartrack">
        <span className={`barfill ${tone}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="barnum">{value}</span>
    </span>
  );
}

function Status({ status }) {
  if (status.state === "awaiting_clock") {
    return (
      <span className="muted">
        on the road to {status.destination} — wakes in {status.wakesIn}
        {status.events ? `, ${status.events} event(s) pending` : ""}
      </span>
    );
  }
  if (status.state === "awaiting_human") {
    return <span style={{ color: "var(--warn)" }}>the lore master is waiting on you</span>;
  }
  return (
    <span className="muted">
      {status.state}
      {status.held ? ` — journey to ${status.held} held` : ""}
    </span>
  );
}

export default function Page() {
  const [data, setData] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(null);
  const storyEnd = useRef(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/state", { cache: "no-store" });
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    storyEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [data?.story?.length]);

  async function post(path, body, label) {
    setBusy(label);
    try {
      await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (!data) return <main><section><p className="empty">loading…</p></section></main>;

  const { status, story, machinery, gap, chat, vitals } = data;

  return (
    <>
      <header>
        <h1>tesbota</h1>
        <span className="muted">{status.turn}</span>
        <Status status={status} />
        <Bar label="hp" value={vitals?.health ?? 100} max={100} tone="hp" />
        <Bar label="fat" value={vitals?.fatigue ?? 0} max={100} tone="fat" />
        <span style={{ marginLeft: "auto" }}>
          <button className="ghost" onClick={() => post("/api/step", null, "step")} disabled={!!busy}>
            {busy === "step" ? "stepping…" : "step"}
          </button>
        </span>
      </header>

      <main>
        <section>
          <h2>Explorer</h2>
          {story.length === 0 && <p className="empty">nothing has happened yet</p>}
          {story.map((t) => (
            <div className="turn" key={t.id}>
              <span className="tid">{t.id}</span>
              {t.cue && <div className="cue">{t.cue}</div>}
              {t.action && <div className="action">{t.action}</div>}
              {t.narration && <div className="narration">{t.narration}</div>}
            </div>
          ))}
          <div ref={storyEnd} />
        </section>

        <section>
          <h2>Game master</h2>
          {machinery.length === 0 && <p className="empty">no claims adjudicated yet</p>}
          {machinery.map((m) => {
            const verdicts = Object.fromEntries(m.verdicts.map((v) => [v.claim, v]));
            return (
              <div className="turn" key={m.id}>
                <span className="tid">
                  {m.id}
                  {m.minutes ? ` · ${m.minutes}min` : ""}
                  {m.fatigue ? ` · ${m.fatigue > 0 ? "+" : ""}${m.fatigue} fat` : ""}
                  {m.retries > 0 ? ` · ${m.retries} redraft(s)` : ""}
                </span>
                {m.claims.map((c) => {
                  const v = verdicts[c.id];
                  return (
                    <div className="claim" key={c.id}>
                      <span className={`v ${v?.result || "UNRESOLVED"}`}>{v?.result || "—"}</span>
                      {c.text}
                      {v?.why && <span className="why">{v.why}</span>}
                      {v?.alternative && <span className="why">→ {v.alternative}</span>}
                    </div>
                  );
                })}
                {m.quotes.map((q, i) => (
                  <div className="claim" key={i}>
                    <span className="v TRUE">QUOTED</span>
                    {q.src}
                  </div>
                ))}
                {m.travel && (
                  <div className="claim">
                    <span className="v FRICTION">TRAVEL</span>
                    {m.travel.resume ? "resumes the road" : `${m.travel.destination}, ${m.travel.leagues} leagues`}
                  </div>
                )}
                {m.correction && (
                  <div className="claim">
                    <span className="v FALSE">REDRAFT</span>
                    <span className="why">{m.correction}</span>
                  </div>
                )}
              </div>
            );
          })}
        </section>

        <section>
          <h2>Lore master</h2>
          {!gap && <p className="empty">the world is not silent right now</p>}
          {gap && (
            <>
              <div className="gapnote">{gap.turn} is blocked on the unresolved claims opposite</div>
              {chat.map((m, i) => (
                <div className={`bubble ${m.role === "you" ? "you" : ""}`} key={i}>
                  <span className="who">{m.role}</span>
                  {m.text}
                </div>
              ))}
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="talk it through…"
                disabled={!!busy}
              />
              <div className="actions">
                <button
                  onClick={async () => {
                    const t = text;
                    setText("");
                    await post("/api/say", { text: t }, "say");
                  }}
                  disabled={!!busy || !text.trim()}
                >
                  {busy === "say" ? "thinking…" : "send"}
                </button>
              </div>
            </>
          )}
        </section>
      </main>
    </>
  );
}
