"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "./icons";
import Kit, { Doll } from "./Kit";
import Sheet from "./Sheet";
import Quests, { QuestPanel } from "./Quests";
import Library from "./Library";
import Data, { face, rare, tone } from "./Data";
import Dossier from "./Dossier";
import Lore from "./Lore";
import Settings from "./Settings";
import Steer from "./Steer";
import Talk from "./Talk";
import { useKeyboardAvoid } from "./keyboard";
import Map from "./Map";
import { Bar, Block, Btn, Bubble, Crumb, Empty, Fold, knowNames, Mark, Note, openDossier, Prose, Tabs, Tag } from "./ui";

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
  swing: "the fight is on — their move",
  fight: "the fight is on — blows falling",
  blows: "the fight is being written",
  lore1: "the record is being checked",
  narrate: "the narrator is writing",
  done: "the world sleeps",
  uninitialised: "nothing has begun",
};

function mood(status, busy) {
  if (status.paused) return "the world is held";
  if (busy) return "the world turns";
  if (status.state === "awaiting_human") return "the world is silent";
  if (status.state === "awaiting_clock") {
    return `the adventurer walks${status.wakesIn ? ` — ${status.wakesIn} to go` : ""}`;
  }
  return MOOD[status.state] || "the world sleeps";
}

const given = (who) => String(who || "").split(" ")[0];

const WALKERS = ["corda", "debug"];

function Brand({ status, busy, walker, onWalker, onSettings }) {
  return (
    <header className="brand">
      <span className="word">BOTA</span>
      <span className="walkers">
        {WALKERS.map((id) => (
          <button
            key={id}
            className={`walker${walker === id ? " on" : ""}`}
            onClick={() => onWalker(id)}
            title={id === "corda" ? "the adventurer" : "a second walker, for trying things"}
          >
            {id === walker && status.who ? given(status.who) : id}
          </button>
        ))}
      </span>
      <span className="mood">{mood(status, busy)}</span>
      <button className="cog" onClick={onSettings} title="settings" aria-label="settings">
        <Icon name="settings" size={15} />
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
  if (x.fight) bits.push(`${x.fight.blows.length} blows`);
  return bits;
}

const SAID_LABEL = { action: "action", look: "looks", say: "says" };
const GM_LABEL = { world: "what happens", answer: "the answer", outcome: "what happens", fight: "the fight" };
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
            {rare(r.band)}
            <span className="outtext">{r.text}</span>
          </p>
        );
      })}
    </Fold>
  );
}

function Check({ c }) {
  const bonus = `${c.bonus >= 0 ? "+" : ""}${c.bonus}`;
  const dice =
    c.rolls && c.rolls.length > 1
      ? `${c.rolls.map((n) => (n === c.roll ? `[${n}]` : n)).join(" ")} — ${c.against.join(" and ")}`
      : c.roll;
  return (
    <Note tone={c.passed ? "good" : "bad"}>
      {c.skill} · d20 {dice} {bonus} = {c.total} vs dc {c.dc} ·{" "}
      {c.passed ? "made it" : "fell short"}
    </Note>
  );
}

const END = {
  beaten: "it went down",
  fled: "you got out",
  killed: "you did not get out",
  broken: "it is not over",
};

function Health({ now, most, side }) {
  const part = most > 0 ? Math.max(0, Math.min(1, now / most)) : 0;
  return (
    <span className={`hbar ${side}`}>
      <span className="hfill" style={{ width: `${part * 100}%` }} />
    </span>
  );
}

const slugOf = (x) =>
  x.id || String(x.name || "").toLowerCase().replace(/['\u2019]/g, "").replace(/[^a-z0-9]+/g, "-");

function Pills({ worn }) {
  return (
    <div className="pills">
      {(worn || []).map((w) => (
        <button
          className="toggle pill"
          key={w.name}
          title={[w.slot, w.does].filter(Boolean).join(" · ") || w.name}
          onClick={() => openDossier(slugOf(w))}
        >
          <Mark name={face(w)} tone="worn">
            <span className={tone(w.rarity)}>{w.name}</span>
          </Mark>
        </button>
      ))}
    </div>
  );
}

function Tile({ who, now, down, acting, side }) {
  const ours = side === "us";
  const power = who.ability;
  const says = power
    ? [
        power.damage ? `${power.damage} dmg` : null,
        power.spawn ? `calls a ${power.spawn.name}` : null,
        power.advantage ? "advantage" : null,
        power.cooldown ? `cooldown ${power.cooldown}` : power.spawn ? "once" : null,
        power.sleep ? `then still ${power.sleep}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;
  const rows = [
    ["attack", `${who.damage} dmg`, false],
    ...(power ? [[power.name, says, true]] : []),
    ...(ours ? [] : [["to hit", `dc ${who.dc}`, false]]),
  ];
  return (
    <div className={`tile ${side}${acting ? " acting" : ""}${down ? " down" : ""}`}>
      <p className="cornername">
        <span>{who.name}</span>
        <span className="cornerhp">{down ? "down" : `${now}/${who.most}`}</span>
      </p>
      <Health now={down ? 0 : now} most={who.most} side={side} />
      <div className="cornerbody">
        {ours && who.worn?.length > 0 && (
          <>
            <p className="cap tilecap">equipped</p>
            <Pills worn={who.worn} />
          </>
        )}
        <p className="cap tilecap">abilities</p>
        {rows.map(([what, said, stacked]) => (
          <p className={`statline${stacked ? " stacked" : ""}`} key={what}>
            <span className="statslot">{what}</span>
            <span className="statwhat">
              <span className={stacked ? "statdoes" : "statname"}>{said}</span>
            </span>
          </p>
        ))}
      </div>
    </div>
  );
}

function Arena({ f, at, ended }) {
  const blow = at > 0 ? f.blows[at - 1] : null;
  const acting = at > 0 && !ended ? blow?.who : at > 0 ? null : f.us[0]?.id;
  const stand = (side, who) => {
    const snap = blow?.[side]?.find((x) => x.id === who.id);
    if (snap) return { now: snap.health, down: snap.dead, there: true };
    return { now: who.most, down: false, there: !blow };
  };
  const over = ended && at >= (f.blows || []).length;
  return (
    <div className="arena">
      {over && (
        <p className={`ended ${ended}`}>
          {END[ended] || "it is not over"}
          {f.round > 1 ? ` · ${f.round} rounds` : ""}
        </p>
      )}
      {["us", "them"].map((side) => (
        <div className={`ranks ${side}`} key={side}>
          {(f[side] || []).map((who) => {
            const { now, down, there } = stand(side, who);
            if (!there) return null;
            return (
              <Tile
                key={who.id}
                who={who}
                now={now}
                down={down}
                acting={who.id === acting}
                side={side}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Blows({ f }) {
  const blows = f.blows || [];
  const [at, setAt] = useState(blows.length);
  const running = useRef(null);

  // A fight still being rolled arrives a blow at a time, and the bars follow it.
  // A fight already over opens settled, and is replayed only if asked.
  useEffect(() => {
    if (!running.current) setAt(blows.length);
  }, [blows.length]);

  const stop = () => {
    clearInterval(running.current);
    running.current = null;
  };

  const replay = () => {
    stop();
    setAt(0);
    running.current = setInterval(() => {
      setAt((n) => {
        if (n >= blows.length) {
          stop();
          return n;
        }
        return n + 1;
      });
    }, 850);
  };

  useEffect(() => stop, []);

  return (
    <div className="fight">
      <p className="fightline">
        <Prose as="span" text={(at > 0 ? blows[at - 1]?.text : "") || f.said || ""} />
      </p>
      <Arena f={f} at={at} ended={f.ended} />
      {f.ended && blows.length > 1 && (
        <button className="mkey replay" onClick={replay}>
          {at >= blows.length ? "play it back" : `blow ${at} of ${blows.length}`}
        </button>
      )}

    </div>
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
      {told?.fight ? (
        <Blows f={told.fight} />
      ) : told?.text ? (
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
      {x.fight ? (
        <Blows f={x.fight} />
      ) : x.text ? (
        <Prose className="body told" text={x.text} />
      ) : (
        <p className="body waiting">waiting for an answer…</p>
      )}
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
        <Crumb where={s.where} short />
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

const KINDS = ["places", "people", "books", "items"];
const REMEMBER = "tesbota.sub";

const ICONS = { places: "pin", people: "people", books: "book", items: "box" };

const LAYER_ICON = {
  common: "lines",
  writing: "pen",
  explorer: "person",
  gm: "dice",
  propose: "dice",
  lore1: "lines",
  lore2: "scales",
  queries: "scales",
  lore3: "silence",
  lore4: "pen",
};

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
    ...KINDS.map((id) => ({ id, label: id, icon: ICONS[id] })),
    { id: "data", label: "data", icon: "db" },
  ],
};

const TABS = [
  { id: "chat", label: "chat", icon: "chat" },
  { id: "map", label: "map", icon: "map" },
  { id: "me", label: "you", icon: "person" },
  { id: "library", label: "library", icon: "shelf" },
];

export default function Page() {
  const [data, setData] = useState(null);
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("chat");
  const [dossier, setDossier] = useState(null);
  const [sub, setSub] = useState({ chat: "talk", me: "equipped", library: "places" });
  const [counts, setCounts] = useState({});
  const [quest, setQuest] = useState(null);
  const [catalogue, setCatalogue] = useState(null);
  const [sheaf, setSheaf] = useState("lists");
  const [datum, setDatum] = useState("names");
  const [draft, setDraft] = useState(null);
  const pen = useRef(null);
  const [settings, setSettings] = useState(false);
  const [reading, setReading] = useState(null);
  const [mapAt, setMapAt] = useState(null);
  const [walker, setWalker] = useState(WALKERS[0]);
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
    setDraft(null);
  }, [datum]);

  useEffect(() => {
    setDatum(sheaf === "lists" ? "names" : "common");
  }, [sheaf]);

  useEffect(() => {
    if (tab !== "library" || sub.library !== "data" || catalogue) return;
    fetch("/api/data", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { error: "the machine did not answer" }))
      .then(setCatalogue)
      .catch(() => setCatalogue({ error: "the machine did not answer" }));
  }, [tab, sub.library, catalogue]);

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
    const show = (id) => {
      if (!id) return;
      setDossier(null);
      setQuest(null);
      setReading(null);
      setTab("map");
      setMapAt({ id, asked: Date.now() });
    };
    const onMap = (e) => {
      show(e.detail?.id);
      const url = new URL(window.location.href);
      url.searchParams.set("map", e.detail?.id || "");
      window.history.replaceState(null, "", url);
    };
    window.addEventListener("bota:map", onMap);
    const asked = new URLSearchParams(window.location.search).get("map");
    if (asked) {
      show(asked);
      wasBlocked.current = true;
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

  function editing(what) {
    const kept = (catalogue?.prompts || []).find((p) => p.id === datum);
    const text = draft ?? kept?.source ?? "";
    if (what === "abort") return setDraft(null);
    if (what === "save") {
      if (draft === null) return;
      post("/api/prompt", { id: datum, text }, "prompt").then(() => {
        setDraft(null);
        setCatalogue(null);
      });
      return;
    }
    const el = pen.current;
    const cut = el ? el.selectionStart : text.length;
    const line = what === "common" ? "$COMMON" : "$WRITING";
    setDraft(
      `${text.slice(0, cut).replace(/\n*$/, "")}\n\n${line}\n\n${text.slice(cut).replace(/^\n*/, "")}`
    );
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
              label: t.id === "me" ? given(status.who) || t.label : t.label,
              count: t.id === "me" && tab !== "me" ? open : 0,
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
          </div>
        </div>

        {SUBS[tab] && (
          <Tabs
            className="sub"
            items={SUBS[tab].map((option) => ({
              ...option,
              count: option.id === "quests" ? open : counts[option.id],
              pip: tab === "chat" && option.id === "lore" && blocked,
            }))}
            value={sub[tab]}
            onChange={(next) => pickSub(tab, next)}
          />
        )}

        {tab === "library" && sub.library === "data" && (
          <Tabs
            className="sub reading"
            items={[
              { id: "lists", label: "lists", icon: "list" },
              { id: "prompts", label: "prompts", icon: "pen" },
            ]}
            value={sheaf}
            onChange={setSheaf}
          />
        )}

        {tab === "library" && sub.library === "data" && (
          <Tabs
            className="sub"
            items={
              sheaf === "lists"
                ? [
                    { id: "names", label: "names", icon: "people" },
                    { id: "personality", label: "personality", icon: "pulse" },
                    { id: "rarity", label: "rarity", icon: "dice" },
                    { id: "places", label: "places", icon: "pin" },
                    { id: "items", label: "items", icon: "box" },
                    { id: "kit", label: "kit", icon: "shirt" },
                  ]
                : (catalogue?.prompts || []).map((p) => ({
                    id: p.id,
                    label: p.label,
                    icon: LAYER_ICON[p.id] || "lines",
                  }))
            }
            value={datum}
            onChange={setDatum}
          />
        )}

        {tab === "library" && sub.library === "data" && sheaf === "prompts" && (
          <Tabs
            className="sub"
            items={[
              { id: "save", label: "save", icon: "pen", off: draft === null },
              { id: "abort", label: "abort", icon: "cross", off: draft === null },
              { id: "common", label: "link common", icon: "lines" },
              { id: "writing", label: "link writing", icon: "book" },
            ]}
            value={null}
            onChange={(what) => editing(what)}
          />
        )}

        {reading === "books" && (
          <Tabs
            className="sub reading"
            items={[
              { id: "content", label: "content", icon: "lines" },
              { id: "meta", label: "meta", icon: "info" },
            ]}
            value={face}
            onChange={setFace}
          />
        )}

        <div className="tabbody">
          <div
            className={`tabpanel${
              tab === "chat" || tab === "map" || (tab === "library" && sub.library !== "data")
                ? " flush"
                : ""
            }${tab === "library" && sub.library === "data" && sheaf === "prompts" ? " edit" : ""}`}
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
          {tab === "map" && <Map where={status.where} focus={mapAt} />}
          {tab === "me" && sub.me === "equipped" && <Doll inventory={inventory || []} />}
          {tab === "me" && sub.me === "inventory" && <Kit inventory={inventory || []} />}
          {tab === "me" && sub.me === "stats" && (
            <Sheet vitals={vitals} skills={skills} load={data.load} />
          )}
          {tab === "me" && sub.me === "quests" && (
            <Quests
              quests={quests}
              onOpen={(id) => setQuest(quests.find((q) => q.id === id) || null)}
            />
          )}
          {tab === "library" && sub.library === "data" && (
            <Data
              catalogue={catalogue}
              at={datum}
              draft={draft}
              onDraft={setDraft}
              boxRef={pen}
            />
          )}
          {tab === "library" && sub.library !== "data" && (
            <Library
              dossier={dossier}
              onOpen={openDossier}
              kind={sub.library}
              kinds={KINDS}
              onKind={(next) => pickSub("library", next)}
              onCounts={setCounts}
            />
          )}
          </div>
          <Dossier
            at={dossier}
            who={status.who}
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
