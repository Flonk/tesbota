"use client";

import { useEffect, useRef, useState } from "react";
import { PLACE_ICON, rare, tone } from "./Data";
import { Btn, Empty, Mark, Note, Prose, Stub, Table, Tabs } from "./ui";

const ORDER = ["unique", "legendary", "epic", "rare", "uncommon", "common", ""];
const COUNT = (n) => (n ? String(n) : "");

const OPEN = (v) => !String(v || "").trim() || String(v).includes("$BOTA");
const settled = (v) => (OPEN(v) ? "" : String(v).trim());
const told = (v) => (OPEN(v) ? <Stub /> : String(v).trim());

function span(person) {
  const born = settled(person.born);
  const died = settled(person.died);
  if (!born && !died) return <Stub />;
  if (born && died) return `${born}–${died}`;
  return born ? `${born}–` : `–${died}`;
}

const WRITTEN = ["places", "people", "books", "items", "aspects", "abilities"];

// Somebody in particular, or a kind of thing. The people shelf holds both and they
// are not read the same way.
const FOLK = [
  { id: "npc", label: "npc", icon: "person" },
  { id: "mob", label: "mob", icon: "people" },
];


function branch(row, toggle) {
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
      <Mark name={PLACE_ICON[row.type] || "pin"} title={(row.type || "unsorted").replace(/-/g, " ")}>
        {row.name}
      </Mark>
      {row.kids > 0 && !row.open && <span className="folded">{row.kids}</span>}
    </span>
  );
}

function placeShape(toggle) {
  return {
    cols: "minmax(9rem, 3fr) 3.6rem 3rem",
    fields: [
      { key: "name", label: "place", strong: true, cell: (r) => branch(r, toggle) },
      { key: "exits", label: "ways out", num: true, cell: (r) => COUNT(r.exits) },
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
        cell: (r) => (OPEN(r.lives) ? <Stub /> : r.livesName) },
      { key: "born", label: "lived", dim: true, cell: (r) => span(r) },
    ],
  },
  items: {
    cols: "minmax(8rem, 2fr) minmax(6rem, 1.4fr) 5rem",
    fields: [
      { key: "name", strong: true, label: "item",
        cell: (r) => <span className={tone(r.rarity)}>{r.name}</span> },
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
          <p className="cap">named</p>
          {named.map((r) => (
            <div
              className={`hitname${r.id === selected ? " sel" : ""}`}
              key={r.id}
              data-sel={r.id === selected ? "1" : undefined}
              onClick={() => onOpen(r.id)}
            >
              <span className="ename">{r.name}</span>
              <span className="eid">{r.kind}</span>
            </div>
          ))}
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
  kinds,
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
  const box = useRef(null);
  const order = useRef([]);

  useEffect(() => {
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
      const el = document.activeElement;
      const typing = /^(INPUT|TEXTAREA)$/.test(el?.tagName || "") || el?.isContentEditable;

      if (e.key === "Escape") {
        if (dossier) return;
        setQuery("");
        setHits(null);
        box.current?.blur();
        return;
      }
      if (typing || dossier) return;

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
    onCounts({
      places: (world.places || []).length,
      people: (world.people || []).length,
      aspects: (world.aspects || []).length,
      abilities: (world.abilities || []).length,
      books: books.length,
      items: (world.items || []).length,
    });
  }, [books, world, onCounts]);

  function pick(step) {
    const at = kinds.indexOf(kind);
    onKind(kinds[(at + step + kinds.length) % kinds.length]);
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

  const shape = tree ? placeShape(fold) : COLUMNS[kind];

  return (
    <div className="lib">
      {hits === null && kind === "people" && (
        <Tabs
          className="sub folk"
          items={FOLK.map((f) => ({
            ...f,
            count: (world?.people || []).filter((r) => (f.id === "mob" ? r.mob : !r.mob)).length,
          }))}
          value={folk}
          onChange={setFolk}
        />
      )}

      <form className="seek" onSubmit={search}>
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
        {hits !== null && (
          <Btn onClick={() => setHits(null)} type="button">
            back to {kind}
          </Btn>
        )}
      </form>

      <div className="libbody">
      {hits !== null && <Hits named={named} hits={hits} selected={selected} onOpen={onOpen} />}
      {hits === null && reading && <Empty>reading the shelves…</Empty>}
      {hits === null && !reading && (
        <Table
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
