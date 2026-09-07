"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Empty, openDossier, Prose, Tag } from "./ui";

function Reader({ thing, fragment }) {
  const opening = /^p(\d+)$/.exec(fragment || "");
  const [at, setAt] = useState(0);
  const [whole, setWhole] = useState(false);
  const deck = useRef(null);
  const passages = thing.passages || [];

  const go = useCallback((i) => {
    const el = deck.current;
    if (!el || !el.clientWidth) return;
    el.scrollTo({ left: Math.max(0, i) * el.clientWidth, behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (!opening) return;
    const ord = Number(opening[1]);
    const n = passages.findIndex((p) => p.ord === ord);
    if (n >= 0) requestAnimationFrame(() => go(n));
  }, [opening?.[1], go, passages.length]);

  useEffect(() => {
    if (whole) return;
    function key(e) {
      if (e.key === "ArrowLeft") go(at - 1);
      if (e.key === "ArrowRight") go(at + 1);
    }
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [at, go, whole]);

  if (!passages.length) return <Empty>the book has no text in it yet</Empty>;

  return (
    <div className="reader">
      <div className="rbar">
        <button className="dlink" onClick={() => setWhole(!whole)}>
          {whole ? "one at a time" : "read it straight through"}
        </button>
        {!whole && (
          <span className="rcount">
            {at + 1} / {passages.length}
          </span>
        )}
      </div>

      {whole ? (
        <div className="rwhole">
          {passages.map((p) => (
            <div className="leaf" key={p.ord}>
              <span className="cap rord">{p.ord}</span>
              <Prose className="rtext" text={p.text} />
            </div>
          ))}
        </div>
      ) : (
        <>
          <div
            className="rdeck"
            ref={deck}
            onScroll={(e) => setAt(Math.round(e.target.scrollLeft / (e.target.clientWidth || 1)))}
          >
            {passages.map((p) => (
              <div className="leaf" key={p.ord}>
                <span className="cap rord">{p.ord}</span>
                <Prose className="rtext" text={p.text} />
              </div>
            ))}
          </div>
          <div className="rnums">
            <button className="rstep" onClick={() => go(at - 1)} disabled={at === 0}>
              ‹
            </button>
            {passages.map((p, n) => (
              <button key={p.ord} className={`rnum${n === at ? " on" : ""}`} onClick={() => go(n)}>
                {p.ord}
              </button>
            ))}
            <button
              className="rstep"
              onClick={() => go(at + 1)}
              disabled={at === passages.length - 1}
            >
              ›
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div className="dsec">
      <p className="cap">{label}</p>
      {children}
    </div>
  );
}

function Address({ address }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="daddr"
      title="copy this address"
      onClick={() => {
        navigator.clipboard?.writeText(address).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? "copied" : address}
    </button>
  );
}

function Trail({ chain, self }) {
  return (
    <p className="dtrail">
      {chain.map((p, n) => (
        <span key={p.id}>
          {n > 0 && <span className="sep">›</span>}
          {p.id === self ? (
            <span className="here">{p.name}</span>
          ) : (
            <button className="dlink" onClick={() => openDossier(p.id)}>
              {p.name}
            </button>
          )}
        </span>
      ))}
    </p>
  );
}

export default function Dossier({ at, onClose }) {
  const id = at?.id || null;
  const fragment = at?.fragment || null;
  const [thing, setThing] = useState(null);
  const [missing, setMissing] = useState(false);
  const panel = useRef(null);

  useEffect(() => {
    if (!id) return;
    let live = true;
    setThing(null);
    setMissing(false);
    fetch(`/api/entity/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((t) => live && setThing(t))
      .catch(() => live && setMissing(true));
    return () => {
      live = false;
    };
  }, [id]);

  useEffect(() => {
    if (!id) return;
    function key(e) {
      if (e.key === "Escape") onClose();
    }
    function away(e) {
      if (panel.current && !panel.current.contains(e.target)) onClose();
    }
    document.addEventListener("keydown", key);
    document.addEventListener("mousedown", away);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("mousedown", away);
    };
  }, [id, onClose]);

  if (!id) return null;

  return (
    <div className="dossier">
      <div className="dpanel" ref={panel}>
        <div className="dhead">
          <div className="dtitle">
            {thing?.name || id.replace(/-/g, " ")}
            {thing?.unwritten && <Tag tone="dim">unwritten</Tag>}
            {thing?.stub && <Tag tone="warn">$BOTA</Tag>}
          </div>
          <button className="dclose" onClick={onClose} title="close">
            ×
          </button>
        </div>

        {missing && <Empty>nothing in the world has this address — it is a dangling link</Empty>}
        {!thing && !missing && <Empty>looking it up…</Empty>}

        {thing && (
          <div className="dbody">
            <p className="cap dmeta">
              <span>{thing.kind}</span>
              <span>{thing.introduced ? `first named on ${thing.introduced}` : "nobody recorded when it was first named"}</span>
            </p>
            <Address address={thing.address} />

            {thing.within && (
              <Section label="where it sits">
                {thing.within.length > 1 ? (
                  <Trail chain={thing.within} self={thing.id} />
                ) : (
                  <Empty>nothing says what it is part of</Empty>
                )}
              </Section>
            )}

            <Section label="what is written">
              {thing.claims.length === 0 && <Empty>nothing written yet</Empty>}
              {thing.claims.map((c) => (
                <div
                  className={`dclaim${fragment === `c${c.id}` ? " lit" : ""}`}
                  key={c.id}
                  ref={fragment === `c${c.id}` ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
                >
                  <p className="cap dclaimhead">
                    <span className="dsection">{c.section}</span>
                    <span>{c.turn_id || "no turn"}</span>
                  </p>
                  <Prose text={c.text} className="dclaimtext" />
                </div>
              ))}
            </Section>

            {thing.kind === "books" && (
              <Section label={thing.book?.godhead ? "law, and nothing may contradict it" : "the book"}>
                {thing.book ? (
                  <p className="dline">
                    {thing.book.author_id ? (
                      <button className="dlink" onClick={() => openDossier(thing.book.author_id)}>
                        {thing.book.author}
                      </button>
                    ) : (
                      <span>{thing.book.author || "unattributed"}</span>
                    )}
                    {thing.book.godhead && <Tag tone="gold">godhead</Tag>}
                    <span className="bdate">[{thing.book.written || "no date of writing"}]</span>
                    <span>{thing.book.rarity || "no rarity recorded"}</span>
                  </p>
                ) : (
                  <Empty>it is named as a book but nobody has shelved it</Empty>
                )}
                <Reader thing={thing} fragment={fragment} />
              </Section>
            )}

            {thing.kind === "people" && (
              <Section label="what they wrote">
                {thing.wrote.length === 0 && <Empty>nothing of theirs is on the shelves</Empty>}
                {thing.wrote.map((b) => (
                  <p className="dline" key={b.id}>
                    <button className="dlink" onClick={() => openDossier(b.id)}>
                      {b.name}
                    </button>
                    <span className="bdate">[{b.written || "—"}]</span>
                    <span>{b.rarity || ""}</span>
                  </p>
                ))}
              </Section>
            )}

            {thing.kind === "places" && (
              <Section label="what it contains">
                {thing.contains.length === 0 && <Empty>nothing is recorded inside it</Empty>}
                {thing.contains.map((c) => (
                  <p className="dline" key={c.id}>
                    <button className="dlink" onClick={() => openDossier(c.id)}>
                      {c.name}
                    </button>
                    <span className="dsection">{c.kind || "unwritten"}</span>
                  </p>
                ))}
              </Section>
            )}

            {thing.kind === "places" && (
              <Section label="ways out">
                {thing.exits.length === 0 && <Empty>no way out of it is written down</Empty>}
                {thing.exits.map((x) => (
                  <p className="dline" key={x.id}>
                    <button className="dlink" onClick={() => openDossier(x.id)}>
                      {x.name}
                    </button>
                    <span className="dsection">{x.bearing || "no bearing recorded"}</span>
                    <span>{x.distance || "nobody has measured this"}</span>
                  </p>
                ))}
              </Section>
            )}

            <Section label="what it keeps">
              {thing.holdings.length === 0 && <Empty>it keeps nothing anybody has written down</Empty>}
              {thing.holdings.map((h) => (
                <p className="dline" key={h.name}>
                  <span>{h.name}</span>
                  {h.qty > 1 && <span className="dsection">x{h.qty}</span>}
                  {h.note && <span className="dnote">{h.note}</span>}
                </p>
              ))}
            </Section>

            {thing.heldBy.length > 0 && (
              <Section label="who holds it">
                {thing.heldBy.map((h) => (
                  <p className="dline" key={h.holder}>
                    <button className="dlink" onClick={() => openDossier(h.holder)}>
                      {h.name}
                    </button>
                    {h.qty > 1 && <span className="dsection">x{h.qty}</span>}
                  </p>
                ))}
              </Section>
            )}

            <Section label="referenced in">
              {thing.mentions.length === 0 && <Empty>nothing written mentions it</Empty>}
              {thing.mentions.map((m) => (
                <div className="dmention" key={m.ref}>
                  <p className="cap dclaimhead">
                    <button className="dlink" onClick={() => openDossier(m.entity)}>
                      {m.name}
                    </button>
                    <span className="dsection">{m.section}</span>
                  </p>
                  <Prose className="dsnip" text={m.snippet} />
                </div>
              ))}
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}
