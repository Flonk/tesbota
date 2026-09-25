"use client";

import { abilityLine, abilityWhere, face as itemFace, KIND_ICON, PLACE_ICON, rare } from "./world";
import { useCallback, useEffect, useState } from "react";
import { Crumb, EditBar, Empty, Mark, Note, openDossier, openMap, Overlay, Pill, Prose, rated, Section, settled, Stub, Table, Tabs, tint, told, unrated } from "./ui";
import Icon from "./icons";
import { EDITORS, merged, saveEdits } from "./edit";
import { Field, reader } from "./edit/fields";
import { useSaveKey } from "./keyboard";

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
    { key: "written", label: "written", dim: true, cell: (r) => told(r.written) },
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
  cols: "minmax(9rem, 1fr)",
  fields: [{ key: "name", label: "doors", strong: true, cell: (r) => r.name }],
};

const KEEPS = {
  cols: "minmax(9rem, 1.6fr) 4rem",
  fields: [
    { key: "name", label: "inventory", strong: true, cell: (r) => r.name },
    { key: "qty", label: "count", num: true, cell: (r) => (r.qty === 1 ? "" : r.qty) },
  ],
};

// A village has a latitude and nothing else; a world has the rest of it. Same
// table either way, named for what is actually in it.
const stats = (label) => ({
  cols: "minmax(6rem, 1fr) minmax(6rem, 2fr)",
  fields: [
    { key: "stat", label, strong: true, cell: (r) => r.stat },
    { key: "value", label: "", dim: true, cell: (r) => r.value },
  ],
});

const HELD_BY = {
  cols: "minmax(9rem, 2fr) 4rem",
  fields: [
    { key: "name", label: "held by", strong: true, cell: (r) => r.name },
    { key: "qty", label: "count", num: true, cell: (r) => (r.qty === 1 ? "" : r.qty) },
  ],
};

const FACE = { ...KIND_ICON, people: "person" };

function face_of(thing) {
  if (!thing) return null;
  if (thing.kind === "items") return itemFace(thing.item);
  if (thing.kind === "places") return PLACE_ICON[thing.place?.type] || FACE.places;
  return FACE[thing.kind] || null;
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
      {settled(book.written) ? <Prose as="span" text={book.written} /> : <Stub />}
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
    ...(item?.effects || []).map((e) => ({ id: e.stat, stat: e.stat, value: <Prose as="span" text={e.amount} /> })),
    ...["weight", "worth", "owed_by"]
      .filter((k) => item?.[k])
      .map((k) => ({ id: k, stat: k.replace("_", " "), value: <Prose as="span" text={String(item[k])} /> })),
  ];
  if (!rows.length) return <Empty>nothing is written about what it does</Empty>;
  return <Table rarity={unrated} {...stats("stats")} rows={rows} />;
}

function Body({ body }) {
  const worn = Number(body.worn || 0);
  const own = Number(body.defense || 0);
  const rows = [
    body.health && { id: "health", stat: "health", value: body.health },
    body.damage && { id: "damage", stat: "damage", value: <Prose as="span" text={body.damage} /> },
    body.dc && { id: "dc", stat: "hard to hit", value: `dc ${body.dc}` },
    body.bonus ? { id: "bonus", stat: "swings at", value: `${body.bonus > 0 ? "+" : ""}${body.bonus}` } : null,
    (own || worn) && {
      id: "defense",
      stat: "defense",
      value: worn && own ? `${own + worn} (${worn} worn)` : String(own + worn),
    },
    body.skill && { id: "skill", stat: "fights with", value: <Prose as="span" text={body.skill} /> },
  ].filter(Boolean);
  if (!rows.length) return null;
  return <Table rarity={unrated} {...stats("in a fight")} rows={rows} />;
}

const AU = 1.495978707e11;
const trim = (n, to = 2) => Number(n).toFixed(to).replace(/\.?0+$/, "");

function span(metres) {
  if (metres >= AU / 20) return `${trim(metres / AU, 3)} AU`;
  if (metres >= 1e9) return `${trim(metres / 1e9)} million km`;
  if (metres >= 1000) return `${Math.round(metres / 1000).toLocaleString()} km`;
  return `${Math.round(metres)} m`;
}

const hours = (seconds) => `${trim(seconds / 3600, 3)} h`;

const degrees = (deg, up, down, places = 4) =>
  `${Math.abs(deg).toFixed(places)}°${deg < 0 ? down : up}`;

/**
 * What a world is, and what follows from being it.
 *
 * Nothing here is read off a column except the first few. The year, the day and
 * where it stands right now are solved from the mass it goes round and the
 * distance it keeps, every time this is asked for.
 */
function Sky({ sky, where }) {
  const rows = [
    where?.lat != null && where?.lon != null && {
      id: "where", stat: "position", value: `${degrees(where.lat, "N", "S")}, ${degrees(where.lon, "E", "W")}`,
    },
    sky?.semiMajor != null && {
      id: "semimajor", stat: "semi-major axis", value: span(sky.semiMajor),
    },
    sky?.semiMajor != null && {
      id: "eccentricity", stat: "eccentricity", value: trim(sky.eccentricity, 4) || "0",
    },
    sky?.days_per_year != null && {
      id: "period", stat: "orbital period", value: `${trim(sky.days_per_year, 3)} days`,
    },
    sky?.rotation != null && {
      id: "sidereal", stat: "sidereal rotation", value: hours(sky.rotation),
    },
    // Only worth saying for something that goes round a thing: a body orbiting
    // nothing faces its primary exactly as often as it turns, and the row would
    // just repeat the one above it.
    sky?.solar_day != null && sky?.around && {
      id: "solar", stat: "solar day", value: hours(sky.solar_day),
    },
    sky?.radius != null && {
      id: "radius", stat: "equatorial radius", value: span(sky.radius),
    },
    sky?.oblateness ? {
      id: "oblate", stat: "oblateness", value: String(sky.oblateness),
    } : null,
    sky?.mass != null && {
      id: "mass", stat: "mass", value: `${Number(sky.mass).toExponential(4)} kg`,
    },
    sky?.tilt ? { id: "tilt", stat: "axial tilt", value: `${sky.tilt}°` } : null,
    sky?.subsolar && {
      id: "subsolar", stat: "subsolar point",
      value: `${degrees(sky.subsolar.lat, "N", "S", 2)}, ${degrees(sky.subsolar.lon, "E", "W", 2)}`,
    },
    ...(sky?.seasons || []).map((mark) => ({
      id: mark.name, stat: mark.says || mark.name, value: mark.at || `day ${mark.day}`,
    })),
  ].filter(Boolean);
  if (!rows.length) return null;
  const overhead = sky?.semiMajor != null || sky?.mass != null;
  return <Table rarity={unrated} {...stats(overhead ? "in the sky" : "where it is")} rows={rows} />;
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

const FACES = [
  { id: "content", label: "content", icon: "lines" },
  { id: "meta", label: "meta", icon: "info" },
];

export default function Dossier({ at, onClose, who }) {
  const id = at?.id || null;
  const fragment = at?.fragment || null;
  const [thing, setThing] = useState(null);
  const [missing, setMissing] = useState(false);
  const [face, setFace] = useState("content");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [said, setSaid] = useState(null);
  const dirty = Object.keys(draft).length > 0;

  const load = useCallback(() => {
    if (!id) return () => {};
    let live = true;
    fetch(`/api/entity/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((t) => live && setThing(t))
      .catch(() => live && setMissing(true));
    return () => {
      live = false;
    };
  }, [id]);

  useEffect(() => load(), [load]);

  const change = useCallback((section, value) => setDraft((was) => merged(was, section, value)), []);

  const cancel = useCallback(() => {
    if (dirty && !window.confirm("discard changes?")) return;
    setDraft({});
    setEditing(false);
    setSaid(null);
  }, [dirty]);

  const save = useCallback(async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setSaid(null);
    const { failed, wrong } = await saveEdits({ [id]: draft });
    setSaving(false);
    if (failed[id]) return setSaid({ tone: "bad", text: failed[id] });
    setDraft({});
    setEditing(false);
    setSaid(wrong.length ? { tone: "warn", text: wrong.join(" · ") } : null);
    load();
  }, [dirty, saving, id, draft, load]);

  useSaveKey(editing, save);

  if (!id) return null;

  const Editor = thing ? EDITORS[thing.kind] : null;
  const locked = !!thing?.book?.chronicle;
  const [entity, putEntity] = reader(draft, change, "entity", thing);

  return (
    <Overlay
      onClose={onClose}
      face={face_of(thing) || "search"}
      tone={thing?.kind === "items" ? tint(thing.item?.rarity) : ""}
      title={
        editing ? (
          <input
            className="einput ename"
            value={entity("name") ?? ""}
            onChange={(e) => putEntity("name")(e.target.value)}
            aria-label="name"
          />
        ) : (
          thing?.name || id.replace(/-/g, " ")
        )
      }
      tools={
        thing && !locked ? (
          <button
            className={`dclose dpen${editing ? " on" : ""}`}
            onClick={() => (editing ? cancel() : setEditing(true))}
            title={editing ? "stop editing" : "edit"}
            aria-label="edit"
          >
            <Icon name="pen" size={15} />
          </button>
        ) : null
      }
      bar={
        editing ? (
          <EditBar dirty={dirty} saving={saving} onCancel={cancel} onSave={save} />
        ) : thing?.kind === "books" ? (
          <Tabs sub items={FACES} value={face} onChange={setFace} />
        ) : null
      }
      onEscape={editing ? cancel : null}
      holding={editing && dirty}
      tags={thing?.kind === "people" ? <Lifespan person={thing.person} /> : null}
      copy={thing?.address}
      under={thing ? <Head thing={thing} /> : null}
    >
        {said && <Note tone={said.tone}>{said.text}</Note>}

        {missing && <Empty>nothing in the world has this address — it is a dangling link</Empty>}
        {!thing && !missing && <Empty>looking it up…</Empty>}

        {thing && editing && (
          <div className="dbody editing">
            <Field
              kind="text"
              label="about"
              value={entity("about")}
              onChange={putEntity("about")}
            />
            {Editor && <Editor thing={thing} draft={draft} change={change} />}
          </div>
        )}

        {thing && !editing && (
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
                    <span className="statdoes">{abilityLine(a)}</span>
                    {abilityWhere(a) && <span className="statdoes dim">{abilityWhere(a)}</span>}
                  </div>
                ))}
              </Section>
            )}

            {thing.body && <Body body={thing.body} />}

            {thing.kind === "abilities" && thing.ability && (
              <Section label="what it does">
                <p className="statdoes">{abilityLine(thing.ability)}</p>
                {abilityWhere(thing.ability) && (
                  <p className="statdoes dim">{abilityWhere(thing.ability)}</p>
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
                rarity={unrated}
                {...MARKS}
                rows={(thing.marks || []).map((m) => ({ ...m, id: m.entity }))}
                onOpen={openDossier}
                empty="nothing carries this"
              />
            )}

            {thing.kind === "people" && <Traits person={thing.person} />}

            {thing.kind === "places" && (
              <button className="dlink dmap" onClick={() => openMap(thing.id)}>
                <Mark name="map" gap=".35rem">
                  {thing.place?.type === "celestial-body" ? "show its surface" : "show it on the map"}
                </Mark>
              </button>
            )}

            {thing.kind === "places" && <Sky sky={thing.sky} where={thing.place} />}

            {thing.kind === "items" && <Stats item={thing.item} />}

            {thing.kind === "people" && (
                <Table
                  rarity={rated}
                  {...WROTE}
                  rows={thing.wrote}
                  onOpen={openDossier}
                  empty="nothing of theirs is on the shelves"
                />
            )}

            {thing.kind === "places" && (
                <Table
                  rarity={unrated}
                  {...CONTAINS}
                  rows={thing.contains}
                  onOpen={openDossier}
                  empty="nothing is recorded inside it"
                />
            )}

            {thing.kind === "places" && (thing.lives || []).length > 0 && (
                <Table rarity={unrated} {...LIVES} rows={thing.lives} onOpen={openDossier} />
            )}

            {thing.kind === "places" && (thing.exits || []).length > 0 && (
                <Table
                  rarity={unrated}
                  {...EXITS}
                  rows={thing.exits}
                  onOpen={openDossier}
                />
            )}

            {thing.kind === "people" && !settled(thing.person?.died) && (
              <Table
                rarity={rated}
                {...KEEPS}
                rows={thing.holdings}
                onOpen={openDossier}
                empty="nothing anybody has written down"
              />
            )}

            {thing.heldBy.length > 0 && (
              <Table
                rarity={unrated}
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
