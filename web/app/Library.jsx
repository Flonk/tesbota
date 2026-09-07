"use client";

import { useEffect, useRef, useState } from "react";
import { Empty, Note, Prose, Tag } from "./ui";

const ORDER = ["unique", "rare", "uncommon", "common", ""];
const TONE = { unique: "gold", rare: "warn", uncommon: "good", common: "dim" };
const KINDS = ["places", "people", "books", "items"];
const REMEMBER = "tesbota.library.kind";

const COUNT = (n) => (n ? String(n) : "");

const FILTERS = [
  { id: "unwritten", label: "unwritten", test: (r) => r.unwritten },
  { id: "stub", label: "has $BOTA", test: (r) => r.stub },
  { id: "orphan", label: "orphan", kinds: ["places"], test: (r) => !r.parent },
  { id: "ways", label: "has exits", kinds: ["places"], test: (r) => r.exits > 0 },
  { id: "keeps", label: "holds something", kinds: ["places"], test: (r) => r.keeps > 0 },
  { id: "wrote", label: "wrote something", kinds: ["people"], test: (r) => r.wrote > 0 },
  { id: "known", label: "mentioned somewhere", kinds: ["people"], test: (r) => r.mentions > 0 },
  { id: "godhead", label: "godhead", kinds: ["books"], test: (r) => r.godhead },
  { id: "authored", label: "has an author row", kinds: ["books"], test: (r) => !!r.authorId },
  ...ORDER.filter(Boolean).map((rarity) => ({
    id: `rarity:${rarity}`,
    label: rarity,
    kinds: ["books"],
    group: "rarity",
    test: (r) => r.rarity === rarity,
  })),
];

const COLUMNS = {
  places: {
    cols: "minmax(8rem, 2fr) minmax(6rem, 1.4fr) 4rem 4rem 4rem",
    fields: [
      { key: "name", label: "place", cell: (r) => r.name },
      { key: "parentName", label: "within", cell: (r) => r.parentName || "nowhere", dim: true },
      { key: "contains", label: "holds", cell: (r) => COUNT(r.contains), num: true },
      { key: "exits", label: "ways out", cell: (r) => COUNT(r.exits), num: true },
      { key: "keeps", label: "keeps", cell: (r) => COUNT(r.keeps), num: true },
    ],
  },
  people: {
    cols: "minmax(8rem, 2fr) 4rem 5rem 4rem",
    fields: [
      { key: "name", label: "person", cell: (r) => r.name },
      { key: "wrote", label: "wrote", cell: (r) => COUNT(r.wrote), num: true },
      { key: "mentions", label: "mentioned", cell: (r) => COUNT(r.mentions), num: true },
      { key: "keeps", label: "keeps", cell: (r) => COUNT(r.keeps), num: true },
    ],
  },
  items: {
    cols: "minmax(8rem, 2fr) minmax(6rem, 1.4fr) 5rem",
    fields: [
      { key: "name", label: "item", cell: (r) => r.name },
      { key: "holder", label: "held by", cell: (r) => holderOf(r), dim: true },
      { key: "mentions", label: "mentioned", cell: (r) => COUNT(r.mentions), num: true },
    ],
  },
};

function remembered() {
  try {
    const kind = localStorage.getItem(REMEMBER);
    return KINDS.includes(kind) ? kind : "places";
  } catch {
    return "places";
  }
}

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

function Shelf({ books, selected, onOpen }) {
  return (
    <div className="shelf">
      {books.map((b) => (
        <div
          className={`book${b.id === selected ? " sel" : ""}`}
          key={b.id}
          data-sel={b.id === selected ? "1" : undefined}
          onClick={() => onOpen(b.id)}
        >
          <div className="btitle">
            {b.name}
            {b.godhead && <Tag tone="gold">godhead</Tag>}
          </div>
          <div className="cap bline">
            <span>{b.author || "unattributed"}</span>
            <span className="bdate">[{b.written || "—"}]</span>
            {b.rarity && <Tag tone={TONE[b.rarity] || "dim"}>{b.rarity}</Tag>}
          </div>
        </div>
      ))}
    </div>
  );
}

function List({ kind, rows, sort, onSort, selected, onOpen }) {
  const shape = COLUMNS[kind];
  if (!shape) return null;
  return (
    <div className="etable" style={{ "--cols": shape.cols }}>
      <div className="erow ehead">
        {shape.fields.map((f) => (
          <button
            key={f.key}
            className={`ecol${f.num ? " num" : ""}${sort.key === f.key ? " on" : ""}`}
            onClick={() => onSort(f.key)}
          >
            {f.label}
            {sort.key === f.key && <span className="dir">{sort.dir > 0 ? "↑" : "↓"}</span>}
          </button>
        ))}
      </div>
      {rows.map((r) => (
        <div
          key={r.id}
          data-sel={r.id === selected ? "1" : undefined}
          className={`erow${r.unwritten ? " unwritten" : ""}${r.stub ? " stub" : ""}${
            r.id === selected ? " sel" : ""
          }`}
          title={r.id}
          onClick={() => onOpen(r.id)}
        >
          {shape.fields.map((f) => (
            <span
              key={f.key}
              className={`ecell${f.num ? " num" : ""}${f.dim ? " dim" : ""}${
                f.key === "name" ? " ename" : ""
              }`}
            >
              {f.cell(r)}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
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

export default function Library({ dossier, onOpen }) {
  const [books, setBooks] = useState(null);
  const [world, setWorld] = useState(null);
  const [kind, setKind] = useState(remembered);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState(null);
  const [on, setOn] = useState({});
  const [sort, setSort] = useState({ key: "name", dir: 1 });
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
      }
    }
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });

  useEffect(() => {
    document.querySelector('.lib [data-sel="1"]')?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  function pick(next) {
    setKind((current) => {
      const at = KINDS.indexOf(current);
      const value = typeof next === "number" ? KINDS[(at + next + KINDS.length) % KINDS.length] : next;
      try {
        localStorage.setItem(REMEMBER, value);
      } catch {}
      return value;
    });
    setHits(null);
    setSelected(null);
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
  const counts = {
    places: (world?.places || []).length,
    people: (world?.people || []).length,
    books: shelf.length,
    items: (world?.items || []).length,
  };
  const filters = FILTERS.filter((f) => !f.kinds || f.kinds.includes(kind));
  const active = filters.filter((f) => on[f.id]);

  function keep(row) {
    const groups = {};
    for (const f of active) (groups[f.group || f.id] ||= []).push(f.test(row));
    return Object.values(groups).every((g) => g.some(Boolean));
  }

  function by(key) {
    setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));
  }

  const q = query.trim().toLowerCase();
  const everything = [
    ...(world?.places || []),
    ...(world?.people || []),
    ...shelf.map((b) => ({ ...b, kind: "books" })),
    ...(world?.items || []),
  ];
  const named = q ? everything.filter((r) => r.name.toLowerCase().includes(q)) : [];
  const all = kind === "books" ? shelf : world?.[kind] || [];
  const rows = all
    .filter((r) => !q || r.name.toLowerCase().includes(q) || r.id.includes(q))
    .filter(keep)
    .sort((a, b) =>
      kind === "books" && sort.key === "name"
        ? ORDER.indexOf(a.rarity) - ORDER.indexOf(b.rarity)
        : compare(a, b, sort.key) * sort.dir || compare(a, b, "name")
    );
  const reading = books === null || world === null;

  order.current =
    hits === null
      ? rows.map((r) => r.id)
      : [...named.map((r) => r.id), ...hits.filter((h) => h.entity).map((h) => h.entity)];

  return (
    <div className="lib">
      <form className="seek" onSubmit={search}>
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
          <button type="button" className="subtab on" onClick={() => setHits(null)}>
            back to {kind}
          </button>
        )}
      </form>

      <div className="subbar">
        {KINDS.map((k) => (
          <button key={k} className={`subtab${kind === k ? " on" : ""}`} onClick={() => pick(k)}>
            {k}
            <span className="count">{counts[k]}</span>
          </button>
        ))}
      </div>

      {hits === null && (
        <div className="filters">
          {filters.map((f) => (
            <button
              key={f.id}
              className={`toggle${on[f.id] ? " on" : ""}`}
              onClick={() => setOn((s) => ({ ...s, [f.id]: !s[f.id] }))}
            >
              {f.label}
            </button>
          ))}
          {active.length > 0 && (
            <button className="toggle clear" onClick={() => setOn({})}>
              clear
            </button>
          )}
        </div>
      )}

      {hits !== null && <Hits named={named} hits={hits} selected={selected} onOpen={onOpen} />}
      {hits === null && reading && <Empty>reading the shelves…</Empty>}
      {hits === null && !reading && rows.length === 0 && <Empty>nothing here matches</Empty>}
      {hits === null && !reading && rows.length > 0 && kind === "books" && (
        <Shelf books={rows} selected={selected} onOpen={onOpen} />
      )}
      {hits === null && !reading && rows.length > 0 && kind !== "books" && (
        <List
          kind={kind}
          rows={rows}
          sort={sort}
          onSort={by}
          selected={selected}
          onOpen={onOpen}
        />
      )}
    </div>
  );
}
