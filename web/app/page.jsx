"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "./icons";
import Kit, { Doll } from "./Kit";
import Sheet from "./Sheet";
import Quests from "./Quests";
import Library from "./Library";
import Data from "./Data";
import Dossier from "./Dossier";
import Lore from "./Lore";
import Settings from "./Settings";
import Steer from "./Steer";
import Talk from "./Talk";
import Turn from "./Turn";
import { send } from "./http";
import { useDeck, useSplit } from "./bands";
import { useKeyboardAvoid } from "./keyboard";
import Orbit from "./Orbit";
import { given, KIND_ICON, KINDS } from "./world";
import Machine from "./Machine";
import { Act, Empty, knowNames, openDossier, Row, Tabs } from "./ui";

const MOOD = {
  explorer: "the adventurer is deciding",
  propose: "the adventurer is deciding",
  answer: "it looks closer",
  gm: "the world turns",
  muster: "the record is being checked",
  swing: "the fight is on — their move",
  fight: "the fight is on — blows falling",
  blows: "the fight is being written",
  lore1: "the record is being read",
  lore2: "the record is being checked",
  deliver: "the turn is being applied",
  narrate: "the narrator is writing",
  done: "the world sleeps",
  uninitialised: "nothing has begun",
};

function mood(status, busy) {
  if (status.paused) return "the world is held";
  // The silence is said before anything else, because a job is running through
  // all of it and "the world turns" would swallow whose turn it is to write.
  if (status.state === "arbiter") return "the world is silent";
  if (status.state === "lore3") return "the lore master is writing";
  if (busy) return "the world turns";
  if (status.state === "clock") {
    return `the adventurer walks${status.destination ? ` to ${status.destination}` : ""}${
      status.wakesIn ? ` — ${status.wakesIn} to go` : ""
    }`;
  }
  return MOOD[status.state] || "the world sleeps";
}

const WALKERS = ["corda", "debug"];

function Brand({ status, busy, walker, onWalker, onSettings }) {
  return (
    <Row as="header" ruled={false} className="brand">
      <span className="word">BOTA</span>
      <span className="walkers">
        {WALKERS.map((id) => (
          <Act
            key={id}
            on={walker === id}
            className="walker"
            onClick={() => onWalker(id)}
            title={id === "corda" ? "the adventurer" : "a second walker, for trying things"}
          >
            {id === walker && status.who ? given(status.who) : id}
          </Act>
        ))}
      </span>
      <span className="mood">{mood(status, busy)}</span>
      <button className="cog" onClick={onSettings} title="settings" aria-label="settings">
        <Icon name="settings" size={15} />
      </button>
    </Row>
  );
}

const REMEMBER = "tesbota.sub";

const SUBS = {
  chat: [
    { id: "talk", label: "lore master", icon: "pen" },
    { id: "gm", label: "game master", icon: "dice" },
    { id: "lore", label: "the silence", icon: "silence" },
  ],
  me: [
    { id: "equipped", label: "equipped", icon: "shirt" },
    { id: "inventory", label: "inventory", icon: "box" },
    { id: "stats", label: "stats", icon: "pulse" },
    { id: "quests", label: "quests", icon: "flag" },
  ],
  library: [
    ...KINDS.map((id) => ({ id, label: id, icon: KIND_ICON[id] })),
  ],
  dev: [
    { id: "states", label: "states", icon: "pulse" },
    { id: "lists", label: "lists", icon: "list" },
    { id: "prompts", label: "prompts", icon: "pen" },
  ],
};

const TABS = [
  { id: "chat", label: "chat", icon: "chat" },
  { id: "map", label: "map", icon: "map" },
  { id: "me", label: "you", icon: "person" },
  { id: "library", label: "library", icon: "shelf" },
  { id: "dev", label: "dev", icon: "settings" },
];

export default function Page() {
  const [data, setData] = useState(null);
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("chat");
  const [dossier, setDossier] = useState(null);
  const [sub, setSub] = useState({
    chat: "talk", me: "equipped", library: "places", dev: "states",
  });
  const [counts, setCounts] = useState({});
  const [settings, setSettings] = useState(false);
  const [mapAt, setMapAt] = useState(null);
  const [mapUnsaved, setMapUnsaved] = useState(false);
  const [walker, setWalker] = useState(WALKERS[0]);
  const keyboard = useKeyboardAvoid();
  const app = useRef(null);
  const { split, dragging, handle } = useSplit(app);
  const shown = useRef(null);
  const wasBlocked = useRef(false);
  const deepLinked = useRef(false);
  // Requests that answer for themselves rather than through a job file. A poll
  // must not decide the world is idle while one of them is still out.
  const flight = useRef(0);

  // The page this tab is running was built at some moment; the server knows when
  // the page was last written. If the second is later than the first, this tab is
  // running code that no longer exists and will behave in ways nobody can explain.
  const loaded = useRef(null);
  const [stale, setStale] = useState(false);

  const busy = pending || (data?.job?.running ? data.job.label || "step" : null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (!res.ok) return;
      const next = await res.json();
      if (next.names) knowNames(next.names);
      setData(next);
    } catch {}
  }, []);

  // A quiet world is polled slowly; one with something in flight is polled fast,
  // because that is when a chat is waiting to be told what has happened.
  const moving = !!pending || !!data?.job?.running || data?.status?.state === "lore3";

  useEffect(() => {
    load();
    const id = setInterval(load, moving ? 1000 : 4000);
    return () => clearInterval(id);
  }, [load, moving]);

  useEffect(() => {
    const when = data?.written;
    if (!when) return;
    if (loaded.current === null) loaded.current = when;
    else if (when > loaded.current) setStale(true);
  }, [data]);

  useEffect(() => {
    const asked = document.cookie.match(/(?:^|;\s*)tesbota_who=([^;]*)/);
    if (asked && WALKERS.includes(asked[1])) setWalker(asked[1]);
  }, []);

  const swapWalker = useCallback((id) => {
    if (!WALKERS.includes(id)) return;
    document.cookie = `tesbota_who=${id};path=/;max-age=31536000;samesite=lax`;
    window.location.reload();
  }, []);

  useEffect(() => {
    const open = (e) => setDossier(e.detail);
    window.addEventListener("bota:open", open);
    return () => window.removeEventListener("bota:open", open);
  }, []);

  // There is one map: the world itself. Asking to be shown a place asks the map
  // to come down to it, and asking to be shown a world asks for its surface —
  // which is the same request at two scales rather than two different maps.
  useEffect(() => {
    const show = (id) => {
      if (!id) return;
      setDossier(null);
      setTab("map");
      setMapAt({ id, asked: Date.now() });
    };
    const onMap = (e) => show(e.detail?.id);
    window.addEventListener("bota:map", onMap);
    const url = new URL(window.location.href);
    const asked = url.searchParams.get("map");
    if (asked) {
      show(asked);
      deepLinked.current = true;
      url.searchParams.delete("map");
      window.history.replaceState(null, "", url);
    }
    return () => window.removeEventListener("bota:map", onMap);
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
    if (!data) return;
    if (!data.job?.running && !flight.current) setPending(null);
    const failed = data.job?.error || null;
    if (failed && failed !== shown.current) {
      shown.current = failed;
      setError(failed);
    }
    if (!failed) shown.current = null;
    const stuck = data.status?.state === "arbiter";
    if (stuck && !wasBlocked.current && !deepLinked.current && !mapUnsaved) {
      setTab("chat");
      pickSub("chat", "lore");
    }
    deepLinked.current = false;
    wasBlocked.current = stuck;
  }, [data]);

  const count = data?.slides?.length ?? 0;
  const { deck, at, go, onScroll } = useDeck(count, !!dossier);

  async function post(path, body, label) {
    setPending(label);
    setError(null);
    shown.current = null;
    flight.current += 1;
    const sent = await send(path, body);
    flight.current -= 1;
    if (sent.status === null) {
      setPending(null);
      setError(sent.error);
      return { ok: false, payload: null };
    }
    const { payload } = sent;
    let refused = null;
    if (sent.status >= 300) refused = `${sent.status} — ${label} did not start`;
    else if (payload?.busy) refused = `already running: ${payload.label || "a step"}`;
    else if (payload?.error && payload.error !== "nothing is pending") refused = payload.error;
    if (refused) setError(refused);
    await load();
    // Whoever asked has to be told whether it was taken, so that what they
    // wrote can be put back in front of them rather than quietly dropped.
    return { ok: !refused, payload };
  }

  if (!data) return <div className="empty pad">loading…</div>;

  const { status, slides, gap, chat, vitals, skills, inventory } = data;
  const quests = data.quests || [];
  const blocked = status.state === "arbiter";
  const answering = status.state === "lore3";
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
      {stale && (
        <button className="stale" onClick={() => window.location.reload()}>
          new version — tap to reload
        </button>
      )}

      <Brand
        status={status}
        busy={busy}
        walker={walker}
        onWalker={swapWalker}
        onSettings={() => setSettings(true)}
      />

      {settings && (
        <Settings
          who={status.who}
          speed={status.speed}
          busy={busy}
          onKill={() => post("/api/kill", null, "a new life")}
          onSpeed={(factor) => post("/api/speed", { factor }, "speed")}
          paused={status.paused}
          onPause={(on) => post("/api/pause", { on }, "pause")}
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
        <Row
          middled={false}
          className="tabbar"
          {...handle}
          title="drag to resize"
        >
          <Tabs
            items={TABS.map((t) => ({
              ...t,
              label: t.id === "me" ? given(status.who) || t.label : t.label,
              count: t.id === "me" && tab !== "me" ? open : 0,
              pip: t.id === "chat" && blocked,
            }))}
            value={tab}
            onChange={(next) => {
              if (tab === "map" && next !== "map" && mapUnsaved && !window.confirm("discard unsaved changes?")) return;
              if (next === "map") setMapAt(null);
              setTab(next);
            }}
          />
          <span className="grip" />
          <Act
            onClick={() => go(count - 1)}
            disabled={at >= count - 1}
            aria-label="latest"
            title="jump to the latest turn"
          >
            »
          </Act>
        </Row>

        {SUBS[tab] && (
          <Tabs
            sub
            items={SUBS[tab].map((option) => ({
              ...option,
              count: option.id === "quests" ? open : counts[option.id],
              pip: tab === "chat" && option.id === "lore" && blocked,
            }))}
            value={sub[tab]}
            onChange={(next) => pickSub(tab, next)}
          />
        )}

        <div className="tabbody">
          <div
            className={`tabpanel${
              tab === "chat" || tab === "map" || tab === "library" || (tab === "dev" && sub.dev !== "states")
                ? " flush"
                : ""
            }`}
          >
          {tab === "chat" && sub.chat === "talk" && (
            <Talk
              said={data.talk || []}
              busy={busy}
              onSay={(t) => post("/api/talk", { text: t }, "talk")}
            />
          )}
          {tab === "chat" && sub.chat === "lore" && (
            <Lore
              gap={gap}
              chat={chat}
              busy={busy}
              blocked={blocked}
              answering={answering}
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
          {tab === "map" && <Orbit focus={mapAt} onUnsaved={setMapUnsaved} />}
          {tab === "me" && sub.me === "equipped" && <Doll inventory={inventory || []} />}
          {tab === "me" && sub.me === "inventory" && <Kit inventory={inventory || []} />}
          {tab === "me" && sub.me === "stats" && (
            <Sheet vitals={vitals} skills={skills} load={data.load} />
          )}
          {tab === "me" && sub.me === "quests" && <Quests quests={quests} />}
          {tab === "dev" && sub.dev !== "states" && <Data sheaf={sub.dev} onPost={post} />}
          {tab === "dev" && sub.dev === "states" && <Machine status={status} />}
          {tab === "library" && (
            <Library
              dossier={dossier}
              onOpen={openDossier}
              kind={sub.library}
              onKind={(next) => pickSub("library", next)}
              onCounts={setCounts}
            />
          )}
          </div>
          <Dossier
            key={dossier ? `${dossier.id}#${dossier.fragment || ""}` : ""}
            at={dossier}
            who={status.who}
            onClose={() => setDossier(null)}
          />
        </div>
      </section>
    </div>
  );
}
