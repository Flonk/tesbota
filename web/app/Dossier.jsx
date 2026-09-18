"use client";

import { face as itemFace, PLACE_ICON, rare, tone } from "./Data";
import { useEffect, useState } from "react";
import { Crumb, Empty, Mark, openDossier, openMap, Overlay, Pill, Prose, Stub, Table, Tag } from "./ui";

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

function says(a) {
  return [
    a.damage ? `${a.damage} dmg` : null,
    a.spawn ? `calls ${a.spawn.count || 1} × ${a.spawn.name}` : null,
    a.advantage ? "advantage" : null,
    a.cooldown ? `cooldown ${a.cooldown}` : null,
    a.delay ? `arrives ${a.delay} round${a.delay > 1 ? "s" : ""} later` : null,
    a.sleep ? `sleep ${a.sleep}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function where(a) {
  return [
    a.within ? `within ${a.within.replace(/-/g, " ")}` : null,
    a.in_aspect ? `somewhere ${a.in_aspect.replace(/-/g, " ")}` : null,
    a.in_kind ? `in a ${a.in_kind.replace(/-/g, " ")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

const MARKS = {
  cols: "minmax(8rem, 2fr) minmax(5rem, 1fr)",
  fields: [
    { key: "name", label: "marked", strong: true, cell: (r) => r.name },
    { key: "kind", label: "kind", dim: true, cell: (r) => r.kind || <Stub /> },
  ],
};

const LIVES = {
  cols: "minmax(9rem, 2fr) minmax(6rem, 1.2fr)",
  fields: [
    { key: "name", label: "lives here", strong: true, cell: (r) => r.name },
    { key: "work", label: "trade", dim: true, cell: (r) => r.work || <Stub /> },
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

const KIND = { people: "person", places: "pin", books: "book", items: "box", aspects: "aspect", abilities: "pulse" };

function face_of(thing) {
  if (!thing) return null;
  if (thing.kind === "items") return itemFace(thing.item);
  if (thing.kind === "places") return PLACE_ICON[thing.place?.type] || KIND.places;
  return KIND[thing.kind] || null;
}

function Head({ thing }) {
  if (!thing) return null;
  if (thing.kind === "people") return <Who person={thing.person} />;
  if (thing.kind === "books") return <Wrote book={thing.book} />;
  if (thing.kind === "items") return <Made item={thing.item} />;
  if (thing.kind === "places") {
    const sort = thing.place?.type;
    const chain = (thing.within || []).slice(0, -1);
    const lead = (
      <span className="cap crumblead">{sort ? sort.replace(/-/g, " ") : <Stub />}</span>
    );
    if (!chain.length) return <p className="cap dwho">{lead}</p>;
    return <Crumb className="dwho" lead={<>{lead}<span className="sep">in</span></>} where={chain} />;
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
  const rows = [
    ...["rarity"].filter((k) => item?.[k]).map((k) => ({ id: k, stat: k, value: rare(item[k]) })),
    ...(item?.effects || []).map((e) => ({ id: e.stat, stat: e.stat, value: e.amount })),
    ...["weight", "worth", "owed_by"]
      .filter((k) => item?.[k])
      .map((k) => ({ id: k, stat: k.replace("_", " "), value: item[k] })),
  ];
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

function Traits({ person }) {
  const said = String(person?.traits || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return (
    <Section label="personality">
      {said.length ? (
        <div className="dtraits">
          {said.map((t) => (
            <Pill key={t}>{t}</Pill>
          ))}
        </div>
      ) : (
        <Empty>nobody has said what they are like</Empty>
      )}
    </Section>
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
      tone={thing?.kind === "items" ? tone(thing.item?.rarity) : ""}
      title={thing?.name || id.replace(/-/g, " ")}
      tags={thing?.kind === "people" ? <Lifespan person={thing.person} /> : null}
      copy={thing?.address}
      under={
        thing ? (
          <>
            <Head thing={thing} />
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

            {!(thing.kind === "books" && face === "content") &&
              (thing.about ? (
                <Prose className="dclaimtext dfirst" text={thing.about} />
              ) : (
                <Empty>nothing describes it yet</Empty>
              ))}

            {(thing.aspects || []).length > 0 && (
              <Section label="aspects">
                <div className="dtraits">
                  {thing.aspects.map((a) => (
                    <Pill
                      key={`${a.aspect}-${a.value || ""}`}
                      onClick={() => openDossier(a.aspect)}
                    >
                      {a.name}
                    </Pill>
                  ))}
                </div>
              </Section>
            )}

            {(thing.grants || []).length > 0 && (
              <Section label="grants">
                {thing.grants.map((a) => (
                  <div className="grant" key={a.id}>
                    <button className="dlink granted" onClick={() => openDossier(a.id)}>
                      {a.name}
                    </button>
                    <span className="statdoes">{says(a)}</span>
                    {where(a) && <span className="statdoes dim">{where(a)}</span>}
                  </div>
                ))}
              </Section>
            )}

            {thing.kind === "abilities" && thing.ability && (
              <Section label="what it does">
                <p className="statdoes">{says(thing.ability)}</p>
                {where(thing.ability) && (
                  <p className="statdoes dim">{where(thing.ability)}</p>
                )}
              </Section>
            )}

            {(thing.granted || []).length > 0 && (
              <Section label="granted by">
                <div className="dtraits">
                  {thing.granted.map((a) => (
                    <Pill key={a.id} onClick={() => openDossier(a.id)}>
                      {a.name}
                    </Pill>
                  ))}
                </div>
              </Section>
            )}

            {thing.kind === "aspects" && (
              <Table
                {...MARKS}
                rows={(thing.marks || []).map((m) => ({ ...m, id: m.entity }))}
                onOpen={openDossier}
                empty="nothing carries this"
              />
            )}

            {thing.kind === "people" && <Traits person={thing.person} />}

            {thing.kind === "places" && (
              <button className="dlink dmap" onClick={() => openMap(thing.id)}>
                <Mark name="map" gap=".35rem">show it on the map</Mark>
              </button>
            )}

            {thing.kind === "items" && <Stats item={thing.item} />}

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

            {thing.kind === "places" && (thing.lives || []).length > 0 && (
                <Table {...LIVES} rows={thing.lives} onOpen={openDossier} />
            )}

            {thing.kind === "places" && (
                <Table
                  {...EXITS}
                  rows={thing.exits}
                  onOpen={openDossier}
                  empty="no way out of it is written down"
                />
            )}

            {thing.kind === "people" && !settled(thing.person?.died) && (
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
