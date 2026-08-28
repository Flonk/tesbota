"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Sheet from "./Sheet";
import Quests from "./Quests";

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
        on the road{status.destination ? ` to ${status.destination}` : ""} — {status.wakesIn}
      </span>
    );
  }
  if (status.state === "awaiting_human") {
    return <span style={{ color: "var(--warn)" }}>the world is silent</span>;
  }
  return <span className="muted">{status.state}</span>;
}

function Meta({ s }) {
  const bits = [];
  if (s.minutes) bits.push(`${s.minutes} min`);
  if (s.fatigue) bits.push(`${s.fatigue > 0 ? "+" : ""}${s.fatigue} fatigue`);
  if (s.health) bits.push(`${s.health} hp`);
  if (s.roll) bits.push(`d400 ${s.roll}` + (s.risk > 1 ? ` at risk ${s.risk}` : ""));
  if (s.retries) bits.push(`${s.retries} redraft`);
  if (!bits.length) return null;
  return <div className="meta">{bits.join("  ·  ")}</div>;
}

function Lore({ gap, chat, busy, onSay }) {
  const [text, setText] = useState("");
  return (
    <div className="lore">
      <h2>the world is silent here</h2>
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
            await onSay(t);
          }}
          disabled={!!busy || !text.trim()}
        >
          {busy === "say" ? "thinking…" : "send"}
        </button>
      </div>
    </div>
  );
}

export default function Page() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [questsOpen, setQuestsOpen] = useState(false);
  const [at, setAt] = useState(0);
  const deck = useRef(null);
  const pinned = useRef(true);

  const load = useCallback(async () => {
    const res = await fetch("/api/state", { cache: "no-store" });
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [load]);

  const count = data?.slides?.length ?? 0;

  const go = useCallback(
    (i) => {
      const el = deck.current;
      if (!el || !count) return;
      const next = Math.max(0, Math.min(count - 1, i));
      el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
    },
    [count]
  );

  useEffect(() => {
    if (pinned.current && count) go(count - 1);
  }, [count, go]);

  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === "TEXTAREA") return;
      if (e.key === "ArrowLeft") go(at - 1);
      if (e.key === "ArrowRight") go(at + 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at, go]);

  function onScroll() {
    const el = deck.current;
    if (!el || !el.clientWidth) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    setAt(i);
    pinned.current = i >= count - 1;
  }

  async function post(path, body, label) {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      let payload = null;
      try {
        payload = await res.json();
      } catch {}
      if (!res.ok) setError(`${res.status} — the step did not complete`);
      else if (payload?.error === "nothing is pending") setError(null);
      else if (payload?.error) setError(payload.error);
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  }

  if (!data) return <div className="empty pad">loading…</div>;

  const { status, slides, gap, chat, vitals, skills, inventory } = data;
  const pendingNote = data.note;
  const quests = data.quests || [];
  const activeQuest = quests.find((q) => q.status === "active");
  const blocked = status.state === "awaiting_human";

  return (
    <>
      <header>
        <div className="hleft">
          <h1>tesbota</h1>
          <Status status={status} />
        </div>

        <div className="hmid">
          <Bar label="hp" value={vitals?.health ?? 100} max={100} tone="hp" />
          <Bar label="fat" value={vitals?.fatigue ?? 0} max={100} tone="fat" />
          <Bar label="hun" value={vitals?.hunger ?? 0} max={100} tone="hun" />
        </div>

        <div className="hright">
          {busy && <span className="working">working…</span>}
          <span className="context">
            <span className="place">
              {status.where?.length
                ? status.where.map((p) => p.name).join(" › ")
                : "somewhere unrecorded"}
            </span>
            {activeQuest && <span className="questtag">{activeQuest.title}</span>}
          </span>
          <span className="counter">{count ? `${at + 1} / ${count}` : "—"}</span>
          <button className="ghost" onClick={() => post("/api/step", null, "step")} disabled={!!busy}>
            {busy === "step" ? "…" : "step"}
          </button>
          <button className="ghost" onClick={() => setSheetOpen(true)}>stats</button>
          <button className="ghost" onClick={() => setQuestsOpen(true)}>
            quests{quests.filter((q) => q.status === "active").length ? ` (${quests.filter((q) => q.status === "active").length})` : ""}
          </button>
        </div>
      </header>

      {sheetOpen && (
        <Sheet
          vitals={vitals}
          skills={skills}
          inventory={inventory || []}
          notebook={data.notebook || []}
          onClose={() => setSheetOpen(false)}
        />
      )}

      {questsOpen && <Quests quests={quests} onClose={() => setQuestsOpen(false)} />}

      {error && (
        <div className="error" onClick={() => setError(null)} title="click to dismiss">
          {error}
        </div>
      )}

      <div className="deck" ref={deck} onScroll={onScroll}>
        {slides.map((s, i) => (
          <section className="slide" key={s.id}>
            <article>
              <div className="tid">
                {s.id}
                {s.cue ? ` · ${s.cue}` : ""}
              </div>

              {s.looks?.map((l, n) => (
                <div className="look" key={n}>
                  <p className="lookq">{l.question}</p>
                  <p className="looka">{l.answer}</p>
                </div>
              ))}

              {s.talks?.map((t, n) => (
                <div className="look talk" key={`t${n}`}>
                  <p className="lookq">“{t.question}”</p>
                  <p className="looka">{t.answer}</p>
                </div>
              ))}

              {s.action && <p className="action">{s.action}</p>}
              {s.narration && <p className="narration">{s.narration}</p>}

              <Meta s={s} />

              {s.fate && (
                <div className={`fate ${s.fate.endsWith("fortune") ? "good" : "bad"}`}>
                  {s.fate.replace("_", " ")} — rolled {s.roll} of 400
                </div>
              )}

              {s.claims.length > 0 && (
                <details className="claims">
                  <summary>{s.claims.length} claim{s.claims.length > 1 ? "s" : ""}</summary>
                  {s.claims.map((c) => (
                    <div className="claim" key={c.id}>
                      <span className={`v ${c.verdict?.result || "UNRESOLVED"}`}>
                        {c.verdict?.result || "—"}
                      </span>
                      {c.text}
                      {c.verdict?.why && <span className="why">{c.verdict.why}</span>}
                    </div>
                  ))}
                </details>
              )}

              {s.lore.length > 0 && (
                <details className="claims lorelog">
                  <summary>
                    lore session — {s.lore.length} message{s.lore.length > 1 ? "s" : ""}
                  </summary>
                  {s.loreGap && <div className="loregap">{s.loreGap}</div>}
                  {s.lore.map((m, n) => (
                    <div className={`bubble ${m.role === "you" ? "you" : ""}`} key={n}>
                      <span className="who">{m.role}</span>
                      {m.text}
                    </div>
                  ))}
                </details>
              )}

              {s.note && (
                <div className="notewas">
                  <span className="who">your note</span>
                  {s.note}
                </div>
              )}

              {i === count - 1 && !blocked && (
                <div className="steer">
                  {!noteOpen && (
                    <button className="ghost" onClick={() => { setNoteOpen(true); setNote(pendingNote || ""); }}>
                      {pendingNote ? "note queued — edit" : "note for the next turn"}
                    </button>
                  )}
                  {noteOpen && (
                    <>
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="steer the game master — they will read this and the adventurer will not…"
                        disabled={!!busy}
                      />
                      <div className="actions">
                        <button
                          className="ghost"
                          onClick={() => { setNoteOpen(false); setNote(""); }}
                          disabled={!!busy}
                        >
                          cancel
                        </button>
                        <button
                          onClick={async () => {
                            await post("/api/note", { text: note }, "note");
                            setNoteOpen(false);
                          }}
                          disabled={!!busy}
                        >
                          {busy === "note" ? "saving…" : "queue note"}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {blocked && i === count - 1 && (
                <Lore
                  gap={gap}
                  chat={chat}
                  busy={busy}
                  onSay={(t) => post("/api/say", { text: t }, "say")}
                />
              )}
            </article>
          </section>
        ))}
        {count === 0 && <section className="slide"><article><p className="empty">nothing has happened yet</p></article></section>}
      </div>

      <nav className="dots">
        {slides.map((s, i) => (
          <button
            key={s.id}
            className={`dot ${i === at ? "on" : ""}`}
            onClick={() => go(i)}
            aria-label={s.id}
          />
        ))}
      </nav>
    </>
  );
}
