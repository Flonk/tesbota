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

const PHASE = {
  explorer: "deciding",
  context: "sizing it up",
  answer: "answering",
  propose: "working out the cost",
  confirm: "weighing it",
  gm: "it happens",
  lore1: "checking the record",
  done: "done",
};

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
  return <span className="muted">{PHASE[status.state] || status.state}</span>;
}

function cost(minutes) {
  if (!minutes) return "no time";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m} min`;
}

function toll(x) {
  const bits = [];
  if (x.minutes) bits.push(cost(x.minutes));
  if (x.fatigue) bits.push(`${x.fatigue > 0 ? "+" : ""}${x.fatigue} fatigue`);
  if (x.roll) bits.push(`d400 ${x.roll}`);
  if (x.risk > 1) bits.push(`risk ${x.risk}`);
  return bits;
}

const SAID_LABEL = { action: "action", look: "looks", say: "says" };
const GM_LABEL = { world: "what happens", answer: "the answer", outcome: "what happens" };

function pairUp(phases) {
  const rows = [];
  const list = (phases || []).filter(
    (x) => !["ready", "confirm", "proposal"].includes(x.kind)
  );
  for (let i = 0; i < list.length; i++) {
    const said = list[i];
    if (said.who !== "explorer") {
      rows.push({ key: said.n, told: said });
      continue;
    }
    const told = list[i + 1]?.who === "gm" ? list[i + 1] : null;
    if (told) i++;
    rows.push({ key: said.n, said, told });
  }
  return rows;
}

function Section({ mode, label, kind, children, open }) {
  if (mode === "compact") {
    return (
      <details className="sec sec-compact" open={open}>
        <summary className="sec-label">{label}</summary>
        <div className="sec-fold">{children}</div>
      </details>
    );
  }
  return (
    <div className={`sec sec-${mode}${kind ? ` sec-${kind}` : ""}`}>
      <p className="sec-label">{label}</p>
      {children}
    </div>
  );
}

function Checked({ x }) {
  if (!x) return null;
  if (x.status === "pending" && x.text) return <p className="sec-note">not yet checked</p>;
  if (x.status === "blocked") {
    return <p className="sec-note sec-blocked">the lore master has sent this back</p>;
  }
  return null;
}

function Pair({ said, told }) {
  const isAction = said.kind === "action";
  const label = [SAID_LABEL[said.kind] || said.kind, ...(told ? toll(told) : [])].join(" · ");
  return (
    <Section mode="compact" open={isAction || !told?.text} label={label}>
      <p className="sec-body sec-asked">
        {said.kind === "say" ? `“${said.text}”` : said.text}
      </p>
      {told?.text ? (
        <p className="sec-body sec-told">{told.text}</p>
      ) : (
        <p className="sec-body sec-told sec-waiting">waiting for an answer…</p>
      )}
      <Checked x={told} />
    </Section>
  );
}

function Alone({ x }) {
  const label = [...toll(x)];
  return (
    <Section mode="gm" kind={x.kind} label={label.length ? label.join(" · ") : GM_LABEL[x.kind]}>
      {x.text ? (
        <p className="sec-body">{x.text}</p>
      ) : (
        <p className="sec-body sec-waiting">waiting for an answer…</p>
      )}
      <Checked x={x} />
    </Section>
  );
}

function Meta({ s }) {
  const bits = [];
  if (s.health) bits.push(`${s.health} hp`);
  if (s.retries) bits.push(`${s.retries} redraft`);
  if (!bits.length) return null;
  return <div className="meta">{bits.join("  ·  ")}</div>;
}

function Lore({ gap, chat, busy, onSay }) {
  const [text, setText] = useState("");
  return (
    <div className="lore">
      <h2>the world is silent here</h2>
      {gap?.text && <div className="gaptext">{gap.text}</div>}
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
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [questsOpen, setQuestsOpen] = useState(false);
  const [at, setAt] = useState(0);
  const deck = useRef(null);
  const pinned = useRef(true);
  const shown = useRef(null);

  const busy = pending || (data?.job?.running ? data.job.label || "step" : null);

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
    if (!data) return;
    if (!data.job?.running) setPending(null);
    const failed = data.job?.error || null;
    if (failed && failed !== shown.current) {
      shown.current = failed;
      setError(failed);
    }
    if (!failed) shown.current = null;
  }, [data]);

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
    setPending(label);
    setError(null);
    shown.current = null;
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
      if (!res.ok) setError(`${res.status} — ${label} did not start`);
      else if (payload?.busy) setError(`already running: ${payload.label || "a step"}`);
      else if (payload?.error && payload.error !== "nothing is pending") setError(payload.error);
      await load();
    } catch (err) {
      setPending(null);
      setError(String(err));
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
              <div className="slidehead">
                <div className="tid">
                  {s.id}
                  {s.at ? ` · ${s.at}` : ""}
                  {s.cue ? ` · ${s.cue}` : ""}
                </div>
                {s.where?.length > 0 && (
                  <div className="slideplace">
                    {s.where.map((p, n) => (
                      <span key={p.id || n}>
                        {n > 0 && <span className="sep">›</span>}
                        {p.name}
                      </span>
                    ))}
                  </div>
                )}
                {s.quest && (
                  <div className="slidequest">
                    <span className="qmark">◆</span>
                    {s.quest}
                  </div>
                )}
              </div>

              {pairUp(s.phases).map((r) =>
                r.said ? (
                  <Pair key={r.key} said={r.said} told={r.told} />
                ) : (
                  <Alone key={r.key} x={r.told} />
                )
              )}

              <Meta s={s} />

              {s.fate && (
                <div className={`fate ${s.fate.endsWith("fortune") ? "good" : "bad"}`}>
                  {s.fate.replace("_", " ")} — rolled {s.roll} of 400
                </div>
              )}

              {s.claims.length > 0 && (
                <details className="claims" open={blocked && i === count - 1}>
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
