"use client";

import { useEffect, useRef, useState } from "react";
import { abilityLine, rare } from "./world";
import { Block, Btn, Bubble, Cap, Crumb, Fold, Meter, Note, Pill, Prose, Tag } from "./ui";

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

function Tile({ who, now, down, acting, side }) {
  const ours = side === "us";
  const power = who.ability;
  const says = power
    ? [abilityLine(power), power.spawn && !power.cooldown ? "once" : null].filter(Boolean).join(" · ")
    : null;
  const powers = [
    ["attack", `${who.damage} dmg`],
    ...(power ? [[power.name, says]] : []),
  ];
  const rest = ours ? [] : [["to hit", `dc ${who.dc}`]];
  const marks = who.aspects || [];
  return (
    <div className={`tile ${side}${acting ? " acting" : ""}${down ? " down" : ""}`}>
      <div className="tilepart">
        <p className="cornername">
          <span>{who.name}</span>
          <span className="cornerhp">{down ? "down" : `${now}/${who.most}`}</span>
        </p>
        <Health now={down ? 0 : now} most={who.most} side={side} />
      </div>

      <div className="tilepart">
        {powers.map(([what, said]) => (
          <p className="statline stacked" key={what}>
            <span className="statslot">{what}</span>
            <span className="statwhat">
              <span className="statdoes">{said}</span>
            </span>
          </p>
        ))}
      </div>

      {(rest.length > 0 || marks.length > 0) && (
        <div className="tilepart">
          {marks.length > 0 && (
            <div className="dtraits">
              {marks.map((m) => (
                <Pill key={`${m.name}-${m.value || ""}`}>{m.name}</Pill>
              ))}
            </div>
          )}
          {rest.map(([what, said]) => (
            <p className="statline" key={what}>
              <span className="statslot">{what}</span>
              <span className="statwhat">
                <span className="statname">{said}</span>
              </span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function Arena({ f, at, ended }) {
  const blow = at > 0 ? f.blows[at - 1] : null;
  const acting = at > 0 && !ended ? blow?.who : at > 0 ? null : f.us[0]?.id;
  // Frame nought is how everybody stood before the first blow, not how they would
  // stand fresh — she walks into a fight carrying whatever the road left her.
  const opening = (side, who) =>
    who.opened ??
    (f.blows || []).find((b) => (b[side] || []).some((x) => x.id === who.id))?.[side]?.find(
      (x) => x.id === who.id
    )?.health ??
    who.most;
  const stand = (side, who) => {
    const snap = blow?.[side]?.find((x) => x.id === who.id);
    if (snap) return { now: snap.health, down: snap.dead, there: true };
    return { now: opening(side, who), down: false, there: !blow };
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
        <Btn className="replay" onClick={replay}>
          {at >= blows.length ? "play it back" : `blow ${at} of ${blows.length}`}
        </Btn>
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
        <Cap>
          {s.id}
          {s.at ? ` · ${s.at}` : ""}
          {s.cue ? ` · ${s.cue}` : ""}
        </Cap>
        <Crumb where={s.where} short />
        {s.quest && (
          <div className="tquest">
            <span className="qmark">◆</span>
            {s.quest}
          </div>
        )}
      </div>
      <div className="theadr">
        <Meter label="hp" value={v.health ?? 100} max={100} tone="hp" />
        <Meter label="fat" value={v.fatigue ?? 0} max={100} tone="fat" />
        <Meter label="hun" value={v.hunger ?? 0} max={100} tone="hun" />
      </div>
    </div>
  );
}

export default function Turn({ s, last, blocked, vitals }) {
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
