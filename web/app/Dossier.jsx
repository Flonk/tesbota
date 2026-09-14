"use client";

import { face as itemFace, rare } from "./Data";
import { useEffect, useState } from "react";
import { Empty, openDossier, Overlay, Prose, Stub, Table, Tag } from "./ui";

function Leaves({ thing, fragment }) {
  const passages = thing.passages || [];
  if (!passages.length) return <Empty>the book has no text in it yet</Empty>;
  return (
    <div className="leaves">
      {passages.map((p) => (
        <div
          className={`leaf${fragment === `p${p.ord}` ? " lit" : ""}`}
          key={p.ord}
          ref={
            fragment === `p${p.ord}`
              ? (el) => el?.scrollIntoView({ block: "nearest" })
              : undefined
          }
        >
          <span className="cap rord">{p.ord}</span>
          <Prose className="rtext" text={p.text} />
        </div>
      ))}
    </div>
  );
}

const WROTE = {
  cols: "minmax(9rem, 2fr) 6rem 5rem",
  fields: [
    { key: "name", label: "authored", strong: true, cell: (r) => r.name },
    { key: "written", label: "written", dim: true,
      cell: (r) => (String(r.written || "").includes("$BOTA") || !r.written ? <Stub /> : r.written) },
    { key: "rarity", label: "rarity", cell: (r) => (r.rarity ? rare(r.rarity) : <Stub />) },
  ],
};

const CONTAINS = {
  cols: "minmax(9rem, 2fr) 7rem",
  fields: [
    { key: "name", label: "contains", strong: true, cell: (r) => r.name },
    { key: "kind", label: "kind", dim: true, cell: (r) => r.kind || <Stub /> },
  ],
};

const EXITS = {
  cols: "minmax(9rem, 2fr) 7rem minmax(6rem, 1.4fr)",
  fields: [
    { key: "name", label: "ways out", strong: true, cell: (r) => r.name },
    { key: "bearing", label: "bearing", dim: true, cell: (r) => r.bearing || <Stub /> },
    { key: "distance", label: "how far", dim: true, cell: (r) => r.distance || <Stub /> },
  ],
};

const KEEPS = {
  cols: "minmax(9rem, 1.6fr) 4rem",
  fields: [
    { key: "name", label: "inventory", strong: true, cell: (r) => r.name },
    { key: "qty", label: "count", num: true, cell: (r) => (r.qty === 1 ? "" : r.qty) },
  ],
};

const WRITING = {
  cols: "minmax(8rem, 2fr) minmax(5rem, 1fr)",
  fields: [
    {
      key: "author",
      label: "author",
      strong: true,
      cell: (r) => (
        <>
          {r.author || <Stub />}
          {r.godhead && <Tag tone="gold">godhead</Tag>}
        </>
      ),
    },
    {
      key: "written",
      label: "written",
      dim: true,
      cell: (r) => (settled(r.written) ? r.written : <Stub />),
    },
  ],
};

const STATS = {
  cols: "minmax(6rem, 1fr) minmax(6rem, 2fr)",
  fields: [
    { key: "stat", label: "stats", strong: true, cell: (r) => r.stat },
    { key: "value", label: "", dim: true, cell: (r) => r.value },
  ],
};

const HELD_BY = {
  cols: "minmax(9rem, 2fr) 4rem",
  fields: [
    { key: "name", label: "held by", strong: true, cell: (r) => r.name },
    { key: "qty", label: "count", num: true, cell: (r) => (r.qty === 1 ? "" : r.qty) },
  ],
};

const KIND = { people: "person", places: "pin", books: "book", items: "box" };

function face_of(thing) {
  if (!thing) return null;
  if (thing.kind === "items") return itemFace(thing.item);
  return KIND[thing.kind] || null;
}

function Head({ thing }) {
  if (!thing) return null;
  if (thing.kind === "people") return <Who person={thing.person} />;
  if (thing.kind === "books") return <Wrote book={thing.book} />;
  if (thing.kind === "items") return <Made item={thing.item} />;
  if (thing.kind === "places" && thing.within?.length > 1) {
    const parent = thing.within[thing.within.length - 2];
    return (
      <p className="cap dwho">
        in{" "}
        <button className="dlink" onClick={() => openDossier(parent.id)}>
          {parent.name}
        </button>
      </p>
    );
  }
  return null;
}

function Wrote({ book }) {
  if (!book) return null;
  return (
    <p className="cap dwho">
      {book.author_id ? (
        <button className="dlink" onClick={() => openDossier(book.author_id)}>
          {book.author}
        </button>
      ) : (
        book.author || <Stub />
      )}
      {", "}
      {settled(book.written) ? book.written : <Stub />}
      {book.rarity ? <>{", "}{rare(book.rarity)}</> : null}
    </p>
  );
}

function Made({ item }) {
  if (!item) return null;
  return (
    <p className="cap dwho">
      {item.type ? (item.slot ? `${item.type}:${item.slot}` : item.type) : <Stub />}
    </p>
  );
}

function Stats({ item }) {
  const rows = ["rarity", "damage", "protection", "heals", "uses", "worth", "owed_by"]
    .filter((k) => item?.[k])
    .map((k) => ({
      id: k,
      stat: k.replace("_", " "),
      value: k === "rarity" ? rare(item[k]) : item[k],
    }));
  if (!rows.length) return <Empty>nothing is written about what it does</Empty>;
  return <Table {...STATS} rows={rows} />;
}

function Who({ person }) {
  return (
    <p className="cap dwho">
      <Prose as="span" text={person?.work || "$BOTA"} />
      {", "}
      {settled(person?.lives) ? (
        <button className="dlink" onClick={() => openDossier(person.lives)}>
          {person.livesName}
        </button>
      ) : (
        <Stub />
      )}
    </p>
  );
}

const settled = (v) => {
  const text = String(v || "").trim();
  return text && !text.includes("$BOTA") ? text : "";
};

function Lifespan({ person }) {
  return (
    <span className="lifespan">
      <span className="era" title="born">
        <span className="glyph">*</span>
        {settled(person?.born) || <Stub />}
      </span>
      <span className="era" title="died">
        <span className="glyph">†</span>
        {settled(person?.died) || <Stub />}
      </span>
    </span>
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

export default function Dossier({ at, onClose, who, face = "content", onKind }) {
  const id = at?.id || null;
  const fragment = at?.fragment || null;
  const [thing, setThing] = useState(null);
  const [missing, setMissing] = useState(false);


  useEffect(() => {
    onKind?.(thing?.kind || null);
  }, [thing?.kind, onKind]);

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

  if (!id) return null;

  return (
    <Overlay
      onClose={onClose}
      face={face_of(thing) || "search"}
      title={thing?.name || id.replace(/-/g, " ")}
      tags={thing?.kind === "people" ? <Lifespan person={thing.person} /> : null}
      under={
        thing ? (
          <>
            <Head thing={thing} />
            <Address address={thing.address} />
          </>
        ) : null
      }
    >
        {missing && <Empty>nothing in the world has this address — it is a dangling link</Empty>}
        {!thing && !missing && <Empty>looking it up…</Empty>}

        {thing && (
          <div className="dbody">
            {thing.kind === "books" && face === "content" && (
              <Leaves thing={thing} fragment={fragment} />
            )}

            {thing.kind !== "items" && !(thing.kind === "books" && face === "content") && thing.within && (
              <Section label="where it sits">
                {thing.within.length > 1 ? (
                  <Trail chain={thing.within} self={thing.id} />
                ) : (
                  <Empty>nothing says what it is part of</Empty>
                )}
              </Section>
            )}

            {thing.kind === "items" && <Stats item={thing.item} />}

            {!(thing.kind === "books" && face === "content") &&
              (thing.about || thing.kind === "items") && (
              <Section label="what it is">
                {thing.about ? (
                  <Prose className="dclaimtext" text={thing.about} />
                ) : (
                  <Empty>nothing says what it is</Empty>
                )}
              </Section>
            )}

            {thing.kind === "people" && (
                <Table
                  {...WROTE}
                  rows={thing.wrote}
                  onOpen={openDossier}
                  empty="nothing of theirs is on the shelves"
                />
            )}

            {thing.kind === "places" && (
                <Table
                  {...CONTAINS}
                  rows={thing.contains}
                  onOpen={openDossier}
                  empty="nothing is recorded inside it"
                />
            )}

            {thing.kind === "places" && (
                <Table
                  {...EXITS}
                  rows={thing.exits}
                  onOpen={openDossier}
                  empty="no way out of it is written down"
                />
            )}

            {(thing.kind === "people" || thing.kind === "places") &&
              !(thing.kind === "people" && settled(thing.person?.died)) && (
              <Table
                {...KEEPS}
                rows={thing.holdings}
                onOpen={openDossier}
                empty="nothing anybody has written down"
              />
            )}

            {thing.heldBy.length > 0 && (
              <Table
                {...HELD_BY}
                rows={thing.heldBy.map((h) => ({
                  ...h,
                  id: h.holder === "the-explorer" ? null : h.holder,
                  name: h.holder === "the-explorer" ? who || h.name : h.name,
                }))}
                onOpen={openDossier}
              />
            )}

            {!(thing.kind === "books" && face === "content") && thing.mentions.length > 0 && (
            <Section label="referenced in">
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
            )}
          </div>
        )}
    </Overlay>
  );
}
