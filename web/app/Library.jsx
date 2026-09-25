"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KINDS, PLACE_ICON, PLACE_TYPES, RARITIES } from "./world";
import { saveEdits } from "./edit";
import { Field, Pick } from "./edit/fields";
import { typing, useSaveKey } from "./keyboard";
import { Act, Cap, EditBar, Empty, Mark, Note, Pen, Prose, rated, Row, settled, Stub, Table, Tabs, told, unwritten } from "./ui";

const TYPE_CHOICES = PLACE_TYPES.map((t) => [t, t.replace(/-/g, " ")]);
const NARRATOR = "the narrator";
const COUNT = (n) => (n ? String(n) : "");

function span(person) {
  const born = settled(person.born);
  const died = settled(person.died);
  if (!born && !died) return <Stub />;
  if (born && died) return `${born}–${died}`;
  return born ? `${born}–` : `–${died}`;
}

// Somebody in particular, or a kind of thing. The people shelf holds both and they
// are not read the same way.
const FOLK = [
  { id: "npc", label: "npc", icon: "person" },
  { id: "mob", label: "mob", icon: "people" },
];


function branch(row, toggle, face = null) {
  return (
    <span className="twig" style={{ "--depth": row.depth }}>
      {row.kids ? (
        <button
          className="knot"
          title={row.open ? "fold" : "unfold"}
          onClick={(e) => {
            e.stopPropagation();
            toggle(row.id);
          }}
        >
          {row.open ? "▾" : "▸"}
        </button>
      ) : (
        <span className="knot leaf">·</span>
      )}
      {face || (
        <>
          <Mark name={PLACE_ICON[row.type] || "pin"} title={(row.type || "unsorted").replace(/-/g, " ")}>
            {row.name}
          </Mark>
          {row.kids > 0 && !row.open && <span className="folded">{row.kids}</span>}
        </>
      )}
    </span>
  );
}

function placeShape(toggle) {
  return {
    cols: "minmax(9rem, 3fr) 3.6rem 3rem",
    fields: [
      { key: "name", label: "place", strong: true, cell: (r) => branch(r, toggle) },
      { key: "exits", label: "doors", num: true, cell: (r) => COUNT(r.exits) },
      { key: "keeps", label: "keeps", num: true, cell: (r) => COUNT(r.keeps) },
    ],
  };
}

function treeify(places, folded, matches) {
  const known = new Set(places.map((p) => p.id));
  const kids = {};
  for (const place of places) {
    const parent = place.parent && known.has(place.parent) ? place.parent : null;
    (kids[parent] ||= []).push(place);
  }
  const byName = (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  for (const list of Object.values(kids)) list.sort(byName);
  if (kids[null]) {
    kids[null].sort(
      (a, b) => (kids[b.id] ? 1 : 0) - (kids[a.id] ? 1 : 0) || byName(a, b)
    );
  }

  const wanted = new Set();
  if (matches) {
    const by = Object.fromEntries(places.map((p) => [p.id, p]));
    for (const place of places) {
      if (!matches.has(place.id)) continue;
      let walk = place;
      while (walk && !wanted.has(walk.id)) {
        wanted.add(walk.id);
        walk = walk.parent && by[walk.parent] !== walk ? by[walk.parent] : null;
      }
    }
  }

  const out = [];
  const walk = (parent, depth, seen) => {
    for (const place of kids[parent] || []) {
      if (seen.has(place.id)) continue;
      if (matches && !wanted.has(place.id)) continue;
      const children = (kids[place.id] || []).filter((c) => !matches || wanted.has(c.id));
      const open = matches ? true : !folded.has(place.id);
      out.push({ ...place, depth, kids: children.length, open });
      if (open) walk(place.id, depth + 1, new Set([...seen, place.id]));
    }
  };
  walk(null, 0, new Set());
  return out;
}

const COLUMNS = {
  books: {
    cols: "minmax(12rem, 3fr) minmax(6rem, 1.2fr) 5rem",
    fields: [
      { key: "name", label: "book", strong: true, cell: (r) => r.name },
      { key: "author", label: "author", dim: true,
        cell: (r) => (r.godhead ? `${r.author} ✦` : r.author || "unattributed") },
      { key: "written", label: "written", dim: true, cell: (r) => told(r.written) },
    ],
  },
  people: {
    cols: "minmax(6rem, 2fr) minmax(4.5rem, 1.1fr) minmax(5rem, 1.4fr) 5.5rem",
    fields: [
      { key: "name", strong: true, label: "person", cell: (r) => r.name },
      { key: "work", label: "trade", dim: true, cell: (r) => told(r.work) },
      { key: "livesName", label: "where", dim: true,
        cell: (r) => (unwritten(r.lives) ? <Stub /> : r.livesName) },
      { key: "born", label: "lived", dim: true, cell: (r) => span(r) },
    ],
  },
  items: {
    cols: "minmax(8rem, 2fr) minmax(6rem, 1.4fr) 5rem",
    fields: [
      { key: "name", strong: true, label: "item",
        cell: (r) => r.name },
      { key: "holder", label: "held by", cell: (r) => holderOf(r), dim: true },
      { key: "mentions", label: "mentioned", cell: (r) => COUNT(r.mentions), num: true },
    ],
  },
  aspects: {
    cols: "minmax(8rem, 2fr) 4.5rem 4.5rem",
    fields: [
      { key: "name", strong: true, label: "aspect", cell: (r) => r.name },
      { key: "marks", label: "marks", num: true, cell: (r) => COUNT(r.marks) },
      { key: "gives", label: "grants", num: true, cell: (r) => COUNT(r.gives) },
    ],
  },
  abilities: {
    cols: "minmax(8rem, 2fr) 5rem",
    fields: [
      { key: "name", strong: true, label: "ability", cell: (r) => r.name },
      { key: "mentions", label: "mentioned", cell: (r) => COUNT(r.mentions), num: true },
    ],
  },
};

const hold = (node) => <span onClick={(e) => e.stopPropagation()}>{node}</span>;

function editShape(kind, ed, toggle) {
  const line = (section, key, saved = (r) => r[key]) => (r) =>
    hold(<Field value={ed.get(r, section, key, saved(r))} onChange={ed.put(r, section, key, saved(r))} />);
  const choice = (section, key, options) => (r) =>
    hold(
      <Field
        kind="choice"
        options={options}
        value={ed.get(r, section, key, r[key])}
        onChange={ed.put(r, section, key, r[key])}
      />
    );
  const pick = (section, key, of) => (r) =>
    hold(<Pick kind={of} value={ed.get(r, section, key, r[key])} onChange={ed.put(r, section, key, r[key])} />);
  const name = line("entity", "name");
  const dot = { key: "dot", label: "", cell: (r) => ed.mark(r) };
  const shapes = {
    places: {
      cols: "minmax(9rem, 3fr) minmax(6rem, 1.3fr) minmax(6rem, 1.5fr) 3.6rem 3rem 1.2rem",
      fields: [
        { key: "name", label: "place", strong: true, cell: (r) => branch(r, toggle, name(r)) },
        { key: "type", label: "type", dim: true, cell: choice("place", "type", TYPE_CHOICES) },
        { key: "parent", label: "in", dim: true, cell: pick("place", "parent", "places") },
        { key: "exits", label: "doors", num: true, cell: (r) => COUNT(r.exits) },
        { key: "keeps", label: "keeps", num: true, cell: (r) => COUNT(r.keeps) },
        dot,
      ],
    },
    books: {
      cols: "minmax(12rem, 3fr) minmax(6rem, 1.2fr) 6rem 1.2rem",
      fields: [
        { key: "name", label: "book", strong: true, cell: name },
        { key: "author", label: "author", dim: true,
          cell: (r) => (chronicle(r) ? r.author : line("book", "author")(r)) },
        { key: "written", label: "written", dim: true,
          cell: (r) => (chronicle(r) ? told(r.written) : line("book", "written")(r)) },
        dot,
      ],
    },
    people: {
      cols: "minmax(6rem, 2fr) minmax(4.5rem, 1.1fr) minmax(5rem, 1.4fr) 5.5rem 5.5rem 1.2rem",
      fields: [
        { key: "name", strong: true, label: "person", cell: name },
        { key: "work", label: "trade", dim: true, cell: line("person", "work") },
        { key: "livesName", label: "where", dim: true, cell: pick("person", "lives", "places") },
        { key: "born", label: "born", dim: true, cell: line("person", "born") },
        { key: "died", label: "died", dim: true, cell: line("person", "died") },
        dot,
      ],
    },
    items: {
      cols: "minmax(8rem, 2fr) minmax(6rem, 1.2fr) minmax(6rem, 1.4fr) 5rem 1.2rem",
      fields: [
        { key: "name", strong: true, label: "item", cell: name },
        { key: "rarity", label: "rarity", dim: true, cell: choice("item", "rarity", RARITIES) },
        ...COLUMNS.items.fields.slice(1),
        dot,
      ],
    },
  };
  if (shapes[kind]) return shapes[kind];
  const { cols, fields } = COLUMNS[kind];
  return {
    cols: `${cols} 1.2rem`,
    fields: [{ ...fields[0], cell: name }, ...fields.slice(1), dot],
  };
}

function chronicle(book) {
  return String(book.author || "").trim().toLowerCase() === NARRATOR;
}

const same = (a, b) => (a ?? "") === (b ?? "");

function holderOf(row) {
  if (row.holder) return row.holder.replace(/-/g, " ");
  if (row.parentName) return row.parentName;
  return "nobody";
}

function compare(a, b, key) {
  const x = a[key] ?? "";
  const y = b[key] ?? "";
  if (typeof x === "number" && typeof y === "number") return x - y;
  return String(x).toLowerCase().localeCompare(String(y).toLowerCase());
}

function Hits({ named, hits, selected, onOpen }) {
  const bad = hits.find((h) => h.error);
  if (bad) return <Note tone="warn">{bad.error}</Note>;
  if (!hits.length && !named.length) return <Empty>nothing written matches that</Empty>;
  return (
    <div className="hits">
      {named.length > 0 && (
        <div className="named">
          <Cap>named</Cap>
          <Table
            rarity={rated}
            cols="minmax(8rem, 1fr) 6rem"
            fields={[
              { key: "name", strong: true, cell: (r) => r.name },
              { key: "kind", dim: true, cell: (r) => r.kind },
            ]}
            rows={named}
            selected={selected}
            onOpen={onOpen}
          />
        </div>
      )}
      {hits.map((h) => (
        <div
          className={`hit${h.entity === selected ? " sel" : ""}`}
          key={h.ref}
          data-sel={h.entity === selected ? "1" : undefined}
          onClick={() => onOpen(h.entity)}
        >
          <div className="cap hitref">
            <span>{h.name}</span>
            <span className="hitsec">{h.section}</span>
          </div>
          <Prose className="hitline" text={h.hit} />
        </div>
      ))}
    </div>
  );
}

export default function Library({
  dossier,
  onOpen,
  kind,
  onKind,
  onCounts,
}) {
  const [books, setBooks] = useState(null);
  const [world, setWorld] = useState(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState(null);
  const [folk, setFolk] = useState("npc");
  const [sort, setSort] = useState({ key: "name", dir: 1 });
  const [folded, setFolded] = useState(() => new Set());
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [refused, setRefused] = useState({});
  const [said, setSaid] = useState([]);
  const [saving, setSaving] = useState(false);
  const box = useRef(null);
  const order = useRef([]);

  const load = useCallback(() => {
    let live = true;
    Promise.all([
      fetch("/api/library", { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])),
      fetch("/api/entities", { cache: "no-store" }).then((r) => (r.ok ? r.json() : {})),
    ])
      .then(([shelf, rest]) => {
        if (!live) return;
        setBooks(shelf);
        setWorld(rest);
      })
      .catch(() => {
        if (!live) return;
        setBooks([]);
        setWorld({});
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => load(), [load]);

  const changed = Object.keys(draft).length;

  function cancel() {
    if (changed && !window.confirm("discard changes?")) return;
    setDraft({});
    setRefused({});
    setEditing(false);
  }

  async function save() {
    if (!changed || saving) return;
    setSaving(true);
    setSaid([]);
    const { failed, wrong } = await saveEdits(draft);
    setDraft(Object.fromEntries(Object.entries(draft).filter(([id]) => id in failed)));
    setRefused(failed);
    setSaid(wrong);
    setSaving(false);
    if (!Object.keys(failed).length) setEditing(false);
    load();
  }

  useSaveKey(editing && !dossier, save);

  const ed = {
    get: (r, section, key, saved) => {
      const part = draft[r.id]?.[section];
      return part && key in part ? part[key] : saved;
    },
    put: (r, section, key, saved) => (value) => {
      setRefused((was) => {
        if (!(r.id in was)) return was;
        const next = { ...was };
        delete next[r.id];
        return next;
      });
      setDraft((was) => {
        const patch = { ...(was[r.id] || {}) };
        const part = { ...(patch[section] || {}) };
        if (same(value, saved)) delete part[key];
        else part[key] = value;
        if (Object.keys(part).length) patch[section] = part;
        else delete patch[section];
        const next = { ...was };
        if (Object.keys(patch).length) next[r.id] = patch;
        else delete next[r.id];
        return next;
      });
    },
    mark: (r) => {
      if (refused[r.id]) return <span className="hint-bad" title={refused[r.id]}>•</span>;
      if (draft[r.id]) return <span className="gdirty" title="unsaved changes">•</span>;
      return "";
    },
  };

  useEffect(() => {
    function step(by) {
      setSelected((current) => {
        const ids = order.current;
        if (!ids.length) return current;
        const at = ids.indexOf(current);
        if (at < 0) return ids[by > 0 ? 0 : ids.length - 1];
        return ids[Math.min(ids.length - 1, Math.max(0, at + by))];
      });
    }

    function key(e) {
      if (e.defaultPrevented) return;
      const writing = typing(document.activeElement);

      if (editing && !dossier && e.key === "Escape") {
        e.preventDefault();
        cancel();
        return;
      }

      if (e.key === "Escape") {
        if (dossier) return;
        setQuery("");
        setHits(null);
        box.current?.blur();
        return;
      }
      if (writing || dossier) return;

      if (e.key === "/") {
        e.preventDefault();
        box.current?.focus();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        step(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        step(-1);
      } else if (e.key === "Enter") {
        if (selected) onOpen(selected);
      } else if (e.key === "[" || e.key === "]") {
        pick(e.key === "]" ? 1 : -1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (kind !== "places" || !selected) return;
        e.preventDefault();
        setFolded((current) => {
          const next = new Set(current);
          e.key === "ArrowLeft" ? next.add(selected) : next.delete(selected);
          return next;
        });
      }
    }
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });

  useEffect(() => {
    document.querySelector('.lib [data-sel="1"]')?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  useEffect(() => {
    setHits(null);
    setSelected(null);
  }, [kind]);

  useEffect(() => {
    if (books === null || world === null) return;
    onCounts(Object.fromEntries(KINDS.map((k) => [k, (k === "books" ? books : world[k] || []).length])));
  }, [books, world, onCounts]);

  function pick(step) {
    const at = KINDS.indexOf(kind);
    onKind(KINDS[(at + step + KINDS.length) % KINDS.length]);
  }

  function search(e) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return setHits(null);
    fetch(`/api/library?q=${encodeURIComponent(q)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then(setHits)
      .catch(() => setHits([]));
  }

  const shelf = books || [];

  function by(key) {
    setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));
  }

  function fold(id) {
    setFolded((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const q = query.trim().toLowerCase();
  const everything = [
    ...(world?.places || []),
    ...(world?.people || []),
    ...shelf.map((b) => ({ ...b, kind: "books" })),
    ...(world?.items || []),
  ];
  const named = q ? everything.filter((r) => r.name.toLowerCase().includes(q)) : [];
  const held = kind === "books" ? shelf : world?.[kind] || [];
  const all =
    kind === "people" ? held.filter((r) => (folk === "mob" ? r.mob : !r.mob)) : held;
  const hit = (r) => (!q || r.name.toLowerCase().includes(q) || r.id.includes(q));
  const tree = kind === "places";
  const rows = tree
    ? treeify(all, folded, q ? new Set(all.filter(hit).map((r) => r.id)) : null)
    : all
        .filter(hit)
        .sort((a, b) => compare(a, b, sort.key) * sort.dir || compare(a, b, "name"));
  const reading = books === null || world === null;

  order.current =
    hits === null
      ? rows.map((r) => r.id)
      : [...named.map((r) => r.id), ...hits.filter((h) => h.entity).map((h) => h.entity)];

  const shape = editing ? editShape(kind, ed, fold) : tree ? placeShape(fold) : COLUMNS[kind];
  const nameOf = (id) => everything.find((r) => r.id === id)?.name || id;

  return (
    <div className="lib">
      {hits === null && kind === "people" && (
        <Tabs
          sub
          items={FOLK.map((f) => ({
            ...f,
            count: (world?.people || []).filter((r) => (f.id === "mob" ? r.mob : !r.mob)).length,
          }))}
          value={folk}
          onChange={setFolk}
        />
      )}

      <Row as="form" middled={false} className="seek" onSubmit={search}>
        <Mark className="glass" name="search" />
        <input
          ref={box}
          className="seekbox"
          value={query}
          placeholder="filter by name — enter to search everything written"
          onChange={(e) => {
            setQuery(e.target.value);
            setHits(null);
          }}
        />
        {hits !== null && <Act onClick={() => setHits(null)}>back to {kind}</Act>}
        {hits === null && (
          <Pen
            on={editing}
            onClick={() => {
              if (editing) return cancel();
              setSaid([]);
              setEditing(true);
            }}
            title={editing ? "stop editing" : "edit"}
          />
        )}
      </Row>

      {editing && hits === null && (
        <EditBar
          dirty={changed > 0}
          note={changed ? (changed === 1 ? "1 row" : `${changed} rows`) : null}
          saving={saving}
          onCancel={cancel}
          onSave={save}
        />
      )}

      <div className="libbody">
      {hits === null &&
        Object.entries(refused).map(([id, error]) => (
          <Note key={id} tone="bad">
            {nameOf(id)}: {error}
          </Note>
        ))}
      {hits === null && said.length > 0 && <Note tone="warn">{said.join(" · ")}</Note>}
      {hits !== null && <Hits named={named} hits={hits} selected={selected} onOpen={onOpen} />}
      {hits === null && reading && <Empty>reading the shelves…</Empty>}
      {hits === null && !reading && (
        <Table
          rarity={rated}
          cols={shape.cols}
          fields={shape.fields}
          rows={rows}
          sort={tree ? null : sort}
          onSort={tree ? null : by}
          selected={selected}
          onOpen={onOpen}
          empty="nothing here matches"
        />
      )}
      </div>
    </div>
  );
}
