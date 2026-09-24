"use client";

import { face as itemFace, PLACE_ICON, rare, tone } from "./Data";
import { useCallback, useEffect, useState } from "react";
import { Act, Crumb, Empty, Mark, openDossier, openMap, Overlay, Pill, Prose, Row, Stub, Table, Tag } from "./ui";
import Icon from "./icons";
import { EDITORS, merged } from "./edit";
import { Field, forget } from "./edit/fields";

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
    { key: "bearing", label: "bearing", dim: true, cell: (r) => (r.bearing ? <Prose as="span" text={r.bearing} /> : <Stub />) },
    { key: "distance", label: "how far", dim: true, cell: (r) => (r.distance ? <Prose as="span" text={r.distance} /> : <Stub />) },
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

const FIGHTS = { ...STATS, fields: [{ ...STATS.fields[0], label: "in a fight" }, STATS.fields[1]] };

// A village has a latitude and nothing else; a world has the rest of it. Same
// table either way, named for what is actually in it.
const sky_of = (label) => ({ ...STATS, fields: [{ ...STATS.fields[0], label }, STATS.fields[1]] });

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
  return <Table {...STATS} rows={rows} />;
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
  return <Table {...FIGHTS} rows={rows} />;
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
  return <Table {...sky_of(overhead ? "in the sky" : "where it is")} rows={rows} />;
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [said, setSaid] = useState(null);
  const dirty = Object.keys(draft).length > 0;

  useEffect(() => {
    onKind?.(thing?.kind || null);
  }, [thing?.kind, onKind]);

  const load = useCallback(
    (quiet = false) => {
      if (!id) return () => {};
      let live = true;
      if (!quiet) {
        setThing(null);
        setMissing(false);
      }
      fetch(`/api/entity/${encodeURIComponent(id)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((t) => live && setThing(t))
        .catch(() => live && setMissing(true));
      return () => {
        live = false;
      };
    },
    [id]
  );

  useEffect(() => {
    setEditing(false);
    setDraft({});
    setSaid(null);
    return load();
  }, [load]);

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
    try {
      const res = await fetch("/api/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, patch: draft }),
      });
      const back = await res.json().catch(() => null);
      if (!back || back.error) {
        setSaid({ tone: "bad", text: back?.error || "the edit was not saved" });
        return;
      }
      forget();
      setDraft({});
      setEditing(false);
      setSaid(back.wrong?.length ? { tone: "warn", text: back.wrong.join(" · ") } : null);
      load(true);
    } catch (err) {
      setSaid({ tone: "bad", text: String(err) });
    } finally {
      setSaving(false);
    }
  }, [dirty, saving, id, draft, load]);

  useEffect(() => {
    if (!editing) return;
    const key = (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [editing, save]);

  if (!id) return null;

  const Editor = thing ? EDITORS[thing.kind] : null;
  const locked = !!thing?.book?.chronicle;
  const name = draft.entity && "name" in draft.entity ? draft.entity.name : thing?.name;

  return (
    <Overlay
      onClose={onClose}
      face={face_of(thing) || "search"}
      tone={thing?.kind === "items" ? tone(thing.item?.rarity) : ""}
      title={
        editing ? (
          <input
            className="einput ename"
            value={name ?? ""}
            onChange={(e) => change("entity", { name: e.target.value })}
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
      onEscape={editing ? cancel : null}
      holding={editing && dirty}
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
        {editing && (
          <Row className="editbar">
            <span className="gname dim">
              editing
              {dirty && <span className="gdirty" title="unsaved changes">•</span>}
            </span>
            <Act onClick={cancel} disabled={saving} title="cancel (esc)">
              cancel
            </Act>
            <Act className="keep" onClick={save} disabled={!dirty || saving} title="save (ctrl enter)">
              {saving ? "…" : "save"}
            </Act>
          </Row>
        )}
        {said && <p className={`hint hint-${said.tone}`}>{said.text}</p>}

        {missing && <Empty>nothing in the world has this address — it is a dangling link</Empty>}
        {!thing && !missing && <Empty>looking it up…</Empty>}

        {thing && editing && (
          <div className="dbody editing">
            <Field
              kind="text"
              label="about"
              value={draft.entity && "about" in draft.entity ? draft.entity.about : thing.about}
              onChange={(v) => change("entity", { about: v })}
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
                    <span className="statdoes">{says(a)}</span>
                    {where(a) && <span className="statdoes dim">{where(a)}</span>}
                  </div>
                ))}
              </Section>
            )}

            {thing.body && <Body body={thing.body} />}

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
                <Mark name="map" gap=".35rem">
                  {thing.place?.type === "celestial-body" ? "show its surface" : "show it on the map"}
                </Mark>
              </button>
            )}

            {thing.kind === "places" && <Sky sky={thing.sky} where={thing.place} />}

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
