"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Sheet from "./Sheet";
import { QuestPanel } from "./Quests";
import Library from "./Library";
import Dossier from "./Dossier";
import Lore from "./Lore";
import Settings from "./Settings";
import Steer from "./Steer";
import { useKeyboardAvoid } from "./keyboard";
import Map from "./Map";
import { Bar, Block, Btn, Bubble, Crumb, Empty, Fold, knowNames, Note, openDossier, Prose, Tabs, Tag } from "./ui";

const PHASE = {
  explorer: "deciding",
  answer: "answering",
  gm: "it happens",
  lore1: "checking the record",
  done: "done",
};

const MOOD = {
  explorer: "the adventurer is deciding",
  propose: "the adventurer is deciding",
  answer: "it looks closer",
  gm: "the world turns",
  lore1: "the record is being checked",
  narrate: "the narrator is writing",
  done: "the world sleeps",
  uninitialised: "nothing has begun",
};

function mood(status, busy) {
  if (busy) return "the world turns";
  if (status.state === "awaiting_human") return "the world is silent";
  if (status.state === "awaiting_clock") {
    return `the adventurer walks${status.wakesIn ? ` — ${status.wakesIn} to go` : ""}`;
  }
  return MOOD[status.state] || "the world sleeps";
}

function Gear() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3.6" />
      <path d="M19.2 14.6a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.55V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1.03H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.55-1.1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.08A1.7 1.7 0 0 0 10.1 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1.03 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.08a1.7 1.7 0 0 0 1.55 1.03H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.55 1.03z" />
    </svg>
  );
}

function Brand({ status, busy, onSettings }) {
  return (
    <header className="brand">
      <span className="mark">BOTA</span>
      {status.who && <span className="who">— {status.who}</span>}
      <span className="mood">{mood(status, busy)}</span>
      <button className="cog" onClick={onSettings} title="settings" aria-label="settings">
        <Gear />
      </button>
    </header>
  );
}

function Status({ status }) {
  if (status.state === "awaiting_clock") {
    return (
      <span className="stat">
        on the road{status.destination ? ` to ${status.destination}` : ""} — {status.wakesIn}
      </span>
    );
  }
  if (status.state === "awaiting_human") return <span className="stat warn">the world is silent</span>;
  return <span className="stat">{PHASE[status.state] || status.state}</span>;
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
const BAND = { common: "common", rare: "rare", very_rare: "very rare" };
const VERDICT = {
  TRUE: "good",
  WITHIN_BOUNDS: "good",
  FRICTION: "warn",
  FALSE: "bad",
  UNRESOLVED: "place",
};

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

function Checked({ x }) {
  if (!x) return null;
  if (x.status === "pending" && x.text) return <Note>not yet checked</Note>;
  if (x.status === "blocked") return <Note tone="warn">the lore master has sent this back</Note>;
  return null;
}

function Outcomes({ rows, chosen, fortune }) {
  return (
    <Fold
      className="sec-table"
      label={`six ways it could go${
        typeof fortune === "number" ? ` · rolled ${fortune.toFixed(3)}` : ""
      }`}
    >
      {rows.map((r, n) => {
        const hit = chosen && r.text === chosen.text && r.band === chosen.band;
        return (
          <p key={n} className={`outrow${hit ? " hit" : ""}`}>
            <Tag tone={r.band === "very_rare" ? "place" : r.band === "rare" ? "warn" : "dim"}>
              {BAND[r.band] || r.band}
            </Tag>
            <span className="outp">{(r.p * 100).toFixed(1)}%</span>
            <span className="outtext">{r.text}</span>
          </p>
        );
      })}
    </Fold>
  );
}

function Check({ c }) {
  const bonus = `${c.bonus >= 0 ? "+" : ""}${c.bonus}`;
  return (
    <Note tone={c.passed ? "good" : "bad"}>
      {c.skill} · d20 {c.roll} {bonus} = {c.total} vs dc {c.dc} ·{" "}
      {c.passed ? "made it" : "fell short"}
    </Note>
  );
}

function Pair({ said, told }) {
  const wide = said.kind === "action" || said.kind === "say";
  const label = [SAID_LABEL[said.kind] || said.kind, ...(told ? toll(told) : [])].join(" · ");
  return (
    <Fold open={wide || !told?.text} label={label}>
      <Prose className="body said" text={said.kind === "say" ? `“${said.text}”` : said.text} />
      {told?.check && <Check c={told.check} />}
      {told?.outcomes?.length > 0 && (
        <Outcomes rows={told.outcomes} chosen={told.chosen} fortune={told.fortune} />
      )}
      {told?.text ? (
        <Prose className="body told" text={told.text} />
      ) : (
        <p className="body told waiting">waiting for an answer…</p>
      )}
      <Checked x={told} />
    </Fold>
  );
}

function Alone({ x }) {
  const label = toll(x);
  return (
    <Block kind={x.kind} label={label.length ? label.join(" · ") : GM_LABEL[x.kind]}>
      {x.text ? <Prose className="body told" text={x.text} /> : <p className="body waiting">waiting for an answer…</p>}
      <Checked x={x} />
    </Block>
  );
}

function Head({ s, vitals }) {
  const v = s.vitals || vitals || {};
  return (
    <div className="thead">
      <div className="theadl">
        <div className="cap">
          {s.id}
          {s.at ? ` · ${s.at}` : ""}
          {s.cue ? ` · ${s.cue}` : ""}
        </div>
        <Crumb where={s.where} />
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

function Turn({ s, last, blocked, vitals }) {
  return (
    <article>
      <Head s={s} vitals={vitals} />

      {pairUp(s.phases).map((r) =>
        r.said ? <Pair key={r.key} said={r.said} told={r.told} /> : <Alone key={r.key} x={r.told} />
      )}

      {s.fate && (
        <Note tone={s.fate.endsWith("fortune") ? "good" : "bad"}>
          {s.fate.replace("_", " ")} — rolled {s.roll} of 400
        </Note>
      )}

      {s.claims.length > 0 && (
        <Fold
          open={blocked && last}
          label={`${s.claims.length} claim${s.claims.length > 1 ? "s" : ""}`}
        >
          {s.claims.map((c) => (
            <div className="claim" key={c.key || c.id}>
              <Tag tone={VERDICT[c.verdict?.result] || "dim"}>
                {c.verdict?.result || "unruled"}
              </Tag>
              <Prose as="span" text={c.text} />
              {c.verdict?.why && <span className="why">{c.verdict.why}</span>}
            </div>
          ))}
        </Fold>
      )}

      {s.lore.length > 0 && (
        <Fold label={`lore session · ${s.lore.length} message${s.lore.length > 1 ? "s" : ""}`}>
          {s.loreGap && <p className="body ask">{s.loreGap}</p>}
          {s.lore.map((m, n) => (
            <Bubble who={m.role} key={n}>
              {m.text}
            </Bubble>
          ))}
        </Fold>
      )}

      {s.note && (
        <Block kind="note" label="your note">
          <p className="body told">{s.note}</p>
        </Block>
      )}

    </article>
  );
}

const KINDS = ["places", "people", "books", "items", "quests"];
const REMEMBER = "tesbota.sub";

const SUBS = {
  chat: [
    { id: "lore", label: "lore master" },
    { id: "gm", label: "game master" },
  ],
  library: KINDS.map((id) => ({ id, label: id })),
};

const TABS = [
  { id: "chat", label: "chat" },
  { id: "map", label: "map" },
  { id: "stats", label: "stats" },
  { id: "library", label: "library" },
];

export default function Page() {
  const [data, setData] = useState(null);
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("chat");
  const [dossier, setDossier] = useState(null);
  const [sub, setSub] = useState({ chat: "lore", library: "places" });
  const [counts, setCounts] = useState({});
  const [quest, setQuest] = useState(null);
  const [settings, setSettings] = useState(false);
  const [reading, setReading] = useState(null);
  const [face, setFace] = useState("content");
  const keyboard = useKeyboardAvoid();
  const [at, setAt] = useState(0);
  const [split, setSplit] = useState(50);
  const [dragging, setDragging] = useState(false);
  const app = useRef(null);
  const grab = useRef(null);
  const swallow = useRef(false);
  const splitNow = useRef(50);
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
    if (data?.names) knowNames(data.names);
  }, [data]);

  useEffect(() => {
    const open = (e) => {
      setQuest(null);
      setReading(null);
      setFace("content");
      setDossier(e.detail);
    };
    window.addEventListener("bota:open", open);
    return () => window.removeEventListener("bota:open", open);
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(REMEMBER) || "{}");
      setSub((current) => {
        const next = { ...current };
        for (const [owner, options] of Object.entries(SUBS)) {
          if (options.some((o) => o.id === saved[owner])) next[owner] = saved[owner];
        }
        return next;
      });
    } catch {}
  }, []);

  const pickSub = useCallback((owner, next) => {
    setSub((current) => {
      const picked = { ...current, [owner]: next };
      try {
        localStorage.setItem(REMEMBER, JSON.stringify(picked));
      } catch {}
      return picked;
    });
  }, []);

  useEffect(() => {
    const saved = Number(localStorage.getItem("tesbota.split"));
    if (saved >= 15 && saved <= 85) {
      setSplit(saved);
      splitNow.current = saved;
    }
  }, []);

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
    if (stuck && !wasBlocked.current) {
      setTab("chat");
      pickSub("chat", "lore");
    }
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
      if (e.target.tagName === "TEXTAREA" || dossier) return;
      if (e.key === "ArrowLeft") go(at - 1);
      if (e.key === "ArrowRight") go(at + 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at, go, dossier]);

  function onScroll() {
    const el = deck.current;
    if (!el || !el.clientWidth) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    setAt(i);
    pinned.current = i >= count - 1;
  }

  function grabBar(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target.closest("textarea, input")) return;
    const box = app.current?.getBoundingClientRect();
    if (!box) return;
    swallow.current = false;
    grab.current = { box, id: e.pointerId, from: e.clientY, moved: false };
    window.addEventListener("pointermove", dragBar);
    window.addEventListener("pointerup", dropBar);
    window.addEventListener("pointercancel", dropBar);
  }

  function dragBar(e) {
    const g = grab.current;
    if (!g || e.pointerId !== g.id) return;
    if (!g.moved) {
      if (Math.abs(e.clientY - g.from) < 5) return;
      g.moved = true;
      setDragging(true);
    }
    const pct = ((e.clientY - g.box.top) / g.box.height) * 100;
    const next = Math.max(18, Math.min(82, pct));
    splitNow.current = next;
    setSplit(next);
  }

  function dropBar(e) {
    const g = grab.current;
    if (!g || e.pointerId !== g.id) return;
    grab.current = null;
    window.removeEventListener("pointermove", dragBar);
    window.removeEventListener("pointerup", dropBar);
    window.removeEventListener("pointercancel", dropBar);
    if (!g.moved) return;
    setDragging(false);
    swallow.current = true;
    localStorage.setItem("tesbota.split", String(Math.round(splitNow.current)));
  }

  function clickBar(e) {
    if (!swallow.current) return;
    swallow.current = false;
    e.preventDefault();
    e.stopPropagation();
  }

  function evenBar(e) {
    if (e.target.closest("button, textarea, input")) return;
    splitNow.current = 50;
    setSplit(50);
    localStorage.setItem("tesbota.split", "50");
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
  const quests = data.quests || [];
  const blocked = status.state === "awaiting_human";
  const open = quests.filter((q) => q.status === "active").length;

  return (
    <div
      className={`app${dragging ? " dragging" : ""}${keyboard.collapse ? " avoiding" : ""}`}
      ref={app}
      data-avoiding={keyboard.collapse || undefined}
      style={
        keyboard.inset
          ? {
              height: `${keyboard.height}px`,
              transform: keyboard.top ? `translateY(${keyboard.top}px)` : undefined,
            }
          : undefined
      }
    >
      <Brand status={status} busy={busy} onSettings={() => setSettings(true)} />

      {settings && (
        <Settings
          who={status.who}
          busy={busy}
          onKill={() => post("/api/kill", null, "a new life")}
          onClose={() => setSettings(false)}
        />
      )}

      {error && (
        <div className="error" onClick={() => setError(null)} title="click to dismiss">
          {error}
        </div>
      )}

      <section
        className={`band turns${keyboard.collapse === "turns" ? " folded" : ""}`}
        inert={keyboard.collapse === "turns" || undefined}
        style={{
          flex: `0 0 ${
            keyboard.collapse === "turns" ? 0 : keyboard.collapse === "tabs" ? 100 : split
          }%`,
        }}
      >
        <div className="deck" ref={deck} onScroll={onScroll}>
          {slides.map((s, i) => (
            <section className="slide" key={s.id}>
              <Turn s={s} last={i === count - 1} blocked={blocked} vitals={vitals} />
            </section>
          ))}
          {count === 0 && (
            <section className="slide">
              <article>
                <Empty>nothing has happened yet</Empty>
              </article>
            </section>
          )}
        </div>
      </section>

      <section
        className={`band tabsband${keyboard.collapse === "tabs" ? " folded" : ""}`}
        inert={keyboard.collapse === "tabs" || undefined}
      >
        <div
          className="tabbar"
          onPointerDown={grabBar}
          onClickCapture={clickBar}
          onDoubleClick={evenBar}
          title="drag to resize"
        >
          <Tabs
            items={TABS.map((t) => ({
              ...t,
              count: t.id === "library" && tab !== "library" ? open : 0,
              pip: t.id === "chat" && blocked,
            }))}
            value={tab}
            onChange={setTab}
          />
          <span className="grip" />
          <div className="tabright">
            {busy && <span className="stat gold">working…</span>}
            <Status status={status} />
            <Btn
              className="jump"
              onClick={() => go(count - 1)}
              disabled={at >= count - 1}
              aria-label="latest"
              title="jump to the latest turn"
            >
              »
            </Btn>
            <Btn
              tone="gold"
              onClick={() => post("/api/step", null, "step")}
              disabled={!!busy || blocked}
            >
              {busy === "step" ? "…" : "next step"}
            </Btn>
          </div>
        </div>

        {SUBS[tab] && (
          <Tabs
            className="sub"
            items={SUBS[tab].map((option) => ({
              ...option,
              count: counts[option.id],
              pip: tab === "chat" && option.id === "lore" && blocked,
            }))}
            value={sub[tab]}
            onChange={(next) => pickSub(tab, next)}
          />
        )}

        {reading === "books" && (
          <Tabs
            className="sub reading"
            items={[{ id: "content", label: "content" }, { id: "meta", label: "meta" }]}
            value={face}
            onChange={setFace}
          />
        )}

        <div className="tabbody">
          <div className={`tabpanel${tab === "chat" || tab === "library" ? " flush" : ""}`}>
          {tab === "chat" && sub.chat === "lore" && (
            <Lore
              gap={gap}
              chat={chat}
              busy={busy}
              blocked={blocked}
              onSay={(t) => post("/api/say", { text: t }, "say")}
            />
          )}
          {tab === "chat" && sub.chat === "gm" && (
            <Steer
              note={data.note}
              past={slides.filter((s) => s.note).map((s) => ({ id: s.id, note: s.note }))}
              busy={busy}
              onNote={(text) => post("/api/note", { text }, "note")}
            />
          )}
          {tab === "map" && <Map where={status.where} at={status.now} />}
          {tab === "stats" && (
            <Sheet
              vitals={vitals}
              skills={skills}
              inventory={inventory || []}
              notebook={data.notebook || []}
            />
          )}
          {tab === "library" && (
            <Library
              dossier={dossier}
              onOpen={openDossier}
              kind={sub.library}
              kinds={KINDS}
              onKind={(next) => pickSub("library", next)}
              onCounts={setCounts}
              quests={quests}
              onQuest={(id) => setQuest(quests.find((q) => q.id === id) || null)}
            />
          )}
          </div>
          <Dossier
            at={dossier}
            face={face}
            onKind={setReading}
            onClose={() => {
              setDossier(null);
              setReading(null);
            }}
          />
          <QuestPanel quest={quest} onClose={() => setQuest(null)} />
        </div>
      </section>
    </div>
  );
}
