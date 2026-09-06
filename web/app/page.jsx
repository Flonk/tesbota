"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Sheet from "./Sheet";
import Quests from "./Quests";
import Library from "./Library";
import Lore from "./Lore";
import Map from "./Map";

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
  answer: "answering",
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

const BAND = { common: "common", rare: "rare", very_rare: "very rare" };

function Table({ rows, chosen, fortune }) {
  return (
    <details className="sec sec-compact sec-table">
      <summary className="sec-label">
        six ways it could go
        {typeof fortune === "number" ? ` · rolled ${fortune.toFixed(3)}` : ""}
      </summary>
      <div className="sec-fold">
        {rows.map((r, n) => {
          const hit = chosen && r.text === chosen.text && r.band === chosen.band;
          return (
            <p key={n} className={`outrow band-${r.band}${hit ? " hit" : ""}`}>
              <span className="outband">{BAND[r.band] || r.band}</span>
              <span className="outp">{(r.p * 100).toFixed(1)}%</span>
              <span className="outtext">{r.text}</span>
            </p>
          );
        })}
      </div>
    </details>
  );
}

function Check({ c }) {
  const bonus = `${c.bonus >= 0 ? "+" : ""}${c.bonus}`;
  return (
    <p className={`sec-check ${c.passed ? "made" : "missed"}`}>
      {c.skill} · d20 {c.roll} {bonus} = {c.total} vs dc {c.dc} ·{" "}
      {c.passed ? "made it" : "fell short"}
    </p>
  );
}

function Pair({ said, told }) {
  const wide = said.kind === "action" || said.kind === "say";
  const label = [SAID_LABEL[said.kind] || said.kind, ...(told ? toll(told) : [])].join(" · ");
  return (
    <Section mode="compact" open={wide || !told?.text} label={label}>
      <p className="sec-body sec-asked">
        {said.kind === "say" ? `“${said.text}”` : said.text}
      </p>
      {told?.check && <Check c={told.check} />}
      {told?.outcomes?.length > 0 && (
        <Table rows={told.outcomes} chosen={told.chosen} fortune={told.fortune} />
      )}
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

function Head({ s, vitals }) {
  const v = s.vitals || vitals || {};
  return (
    <div className="thead">
      <div className="theadl">
        <div className="tid">
          {s.id}
          {s.at ? ` · ${s.at}` : ""}
          {s.cue ? ` · ${s.cue}` : ""}
        </div>
        {s.where?.length > 0 && (
          <div className="tplace">
            {s.where.map((p, n) => (
              <span key={p.id || n}>
                {n > 0 && <span className="sep">›</span>}
                {p.name}
              </span>
            ))}
          </div>
        )}
        {s.quest && (
          <div className="tquest">
            <span className="qmark">◆</span>
            {s.quest}
          </div>
        )}
      </div>
      <div className="theadr">
        <Bar label="hp" value={v.health ?? 100} max={100} tone="hp" />
        <Bar label="fat" value={v.fatigue ?? 0} max={100} tone="fat" />
        <Bar label="hun" value={v.hunger ?? 0} max={100} tone="hun" />
      </div>
    </div>
  );
}

const TABS = [
  { id: "lore", label: "lore master" },
  { id: "stats", label: "stats" },
  { id: "quests", label: "quests" },
  { id: "library", label: "library" },
];

export default function Page() {
  const [data, setData] = useState(null);
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [tab, setTab] = useState("lore");
  const [at, setAt] = useState(0);
  const deck = useRef(null);
  const pinned = useRef(true);
  const shown = useRef(null);
  const wasBlocked = useRef(false);

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
    const stuck = data.status?.state === "awaiting_human";
    if (stuck && !wasBlocked.current) setTab("lore");
    wasBlocked.current = stuck;
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
  const blocked = status.state === "awaiting_human";
  const open = quests.filter((q) => q.status === "active").length;

  return (
    <div className="app">
      {error && (
        <div className="error" onClick={() => setError(null)} title="click to dismiss">
          {error}
        </div>
      )}

      <section className="band turns">
        <div className="deck" ref={deck} onScroll={onScroll}>
          {slides.map((s, i) => (
            <section className="slide" key={s.id}>
              <article>
                <Head s={s} vitals={vitals} />

                {pairUp(s.phases).map((r) =>
                  r.said ? (
                    <Pair key={r.key} said={r.said} told={r.told} />
                  ) : (
                    <Alone key={r.key} x={r.told} />
                  )
                )}

                {s.fate && (
                  <div className={`fate ${s.fate.endsWith("fortune") ? "good" : "bad"}`}>
                    {s.fate.replace("_", " ")} — rolled {s.roll} of 400
                  </div>
                )}

                {s.claims.length > 0 && (
                  <details className="sec sec-compact claims" open={blocked && i === count - 1}>
                    <summary className="sec-label">
                      {s.claims.length} claim{s.claims.length > 1 ? "s" : ""}
                    </summary>
                    {s.claims.map((c) => (
                      <div className="claim" key={c.key || c.id}>
                        <span className={`v ${c.verdict?.result || "UNRULED"}`}>
                          {c.verdict?.result || "unruled"}
                        </span>
                        {c.text}
                        {c.verdict?.why && <span className="why">{c.verdict.why}</span>}
                      </div>
                    ))}
                  </details>
                )}

                {s.lore.length > 0 && (
                  <details className="sec sec-compact claims lorelog">
                    <summary className="sec-label">
                      lore session · {s.lore.length} message{s.lore.length > 1 ? "s" : ""}
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
                      <button
                        className="ghost"
                        onClick={() => {
                          setNoteOpen(true);
                          setNote(pendingNote || "");
                        }}
                      >
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
                            onClick={() => {
                              setNoteOpen(false);
                              setNote("");
                            }}
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
              </article>
            </section>
          ))}
          {count === 0 && (
            <section className="slide">
              <article>
                <p className="empty">nothing has happened yet</p>
              </article>
            </section>
          )}
        </div>
      </section>

      <section className="band mapband">
        <Map where={status.where} at={status.now} />
      </section>

      <section className="band tabsband">
        <div className="tabbar">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab ${tab === t.id ? "on" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.id === "lore" && blocked && <span className="pip" />}
              {t.id === "quests" && open > 0 && <span className="count">{open}</span>}
            </button>
          ))}
          <span className="grow" />
          {busy && <span className="working">working…</span>}
          <Status status={status} />
          <span className="jump">
            <button className="arrow" onClick={() => go(at - 1)} disabled={at <= 0} aria-label="earlier">‹</button>
            <span className="counter">{count ? `${at + 1}/${count}` : "—"}</span>
            <button className="arrow" onClick={() => go(at + 1)} disabled={at >= count - 1} aria-label="later">›</button>
          </span>
          <button
            className="nextstep"
            onClick={() => post("/api/step", null, "step")}
            disabled={!!busy || blocked}
          >
            {busy === "step" ? "…" : "next step"}
          </button>
        </div>

        <div className="tabpanel">
          {tab === "lore" && (
            <Lore
              gap={gap}
              chat={chat}
              busy={busy}
              blocked={blocked}
              onSay={(t) => post("/api/say", { text: t }, "say")}
            />
          )}
          {tab === "stats" && (
            <Sheet
              vitals={vitals}
              skills={skills}
              inventory={inventory || []}
              notebook={data.notebook || []}
            />
          )}
          {tab === "quests" && <Quests quests={quests} />}
          {tab === "library" && <Library />}
        </div>
      </section>
    </div>
  );
}
