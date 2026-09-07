"use client";

import { useEffect, useRef, useState } from "react";
import Quests from "./Quests";
import { Btn, Empty, Note, Prose, Table, Toggle } from "./ui";

const ORDER = ["unique", "rare", "uncommon", "common", ""];
const COUNT = (n) => (n ? String(n) : "");

const WRITTEN = ["places", "people", "books", "items"];

const FILTERS = [
  { id: "unwritten", label: "unwritten", kinds: WRITTEN, test: (r) => r.unwritten },
  { id: "stub", label: "has $BOTA", kinds: WRITTEN, test: (r) => r.stub },
  { id: "ongoing", label: "ongoing", kinds: ["quests"], group: "status",
    test: (r) => r.status === "active" },
  { id: "finished", label: "finished", kinds: ["quests"], group: "status",
    test: (r) => r.status !== "active" },
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
  books: {
    cols: "minmax(12rem, 3fr) minmax(6rem, 1.2fr) 5rem",
    fields: [
      { key: "name", label: "book", strong: true, cell: (r) => r.name },
      { key: "author", label: "author", dim: true,
        cell: (r) => (r.godhead ? `${r.author} ✦` : r.author || "unattributed") },
      { key: "written", label: "written", dim: true, cell: (r) => r.written || "—" },
    ],
  },
  places: {
    cols: "minmax(8rem, 2fr) minmax(6rem, 1.4fr) 4rem 4rem 4rem",
    fields: [
      { key: "name", strong: true, label: "place", cell: (r) => r.name },
      { key: "parentName", label: "within", cell: (r) => r.parentName || "nowhere", dim: true },
      { key: "contains", label: "holds", cell: (r) => COUNT(r.contains), num: true },
      { key: "exits", label: "ways out", cell: (r) => COUNT(r.exits), num: true },
      { key: "keeps", label: "keeps", cell: (r) => COUNT(r.keeps), num: true },
    ],
  },
  people: {
    cols: "minmax(8rem, 2fr) 4rem 5rem 4rem",
    fields: [
      { key: "name", strong: true, label: "person", cell: (r) => r.name },
      { key: "wrote", label: "wrote", cell: (r) => COUNT(r.wrote), num: true },
      { key: "mentions", label: "mentioned", cell: (r) => COUNT(r.mentions), num: true },
      { key: "keeps", label: "keeps", cell: (r) => COUNT(r.keeps), num: true },
    ],
  },
  items: {
    cols: "minmax(8rem, 2fr) minmax(6rem, 1.4fr) 5rem",
    fields: [
      { key: "name", strong: true, label: "item", cell: (r) => r.name },
      { key: "holder", label: "held by", cell: (r) => holderOf(r), dim: true },
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
  quests = [],
  onQuest,
}) {
  const [books, setBooks] = useState(null);
  const [world, setWorld] = useState(null);
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

  useEffect(() => {
    setHits(null);
    setSelected(null);
  }, [kind]);

  useEffect(() => {
    if (books === null || world === null) return;
    onCounts({
      places: (world.places || []).length,
      people: (world.people || []).length,
      books: books.length,
      items: (world.items || []).length,
      quests: quests.filter((q) => q.status === "active").length,
    });
  }, [books, world, quests, onCounts]);

  function pick(step) {
    const at = kinds.indexOf(kind);
    onKind(kinds[(at + step + kinds.length) % kinds.length]);
  }

  function search(e) {
    e.preventDefault();
    const q = query.trim();
    if (!q || kind === "quests") return setHits(null);
    fetch(`/api/library?q=${encodeURIComponent(q)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then(setHits)
      .catch(() => setHits([]));
  }

  const shelf = books || [];
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
  const errands = quests.map((entry) => ({ ...entry, name: entry.title }));
  const all =
    kind === "books" ? shelf : kind === "quests" ? errands : world?.[kind] || [];
  const rows = all
    .filter((r) => !q || r.name.toLowerCase().includes(q) || r.id.includes(q))
    .filter(keep)
    .sort((a, b) => compare(a, b, sort.key) * sort.dir || compare(a, b, "name"));
  const reading = kind !== "quests" && (books === null || world === null);

  order.current =
    hits === null
      ? rows.map((r) => r.id)
      : [...named.map((r) => r.id), ...hits.filter((h) => h.entity).map((h) => h.entity)];

  const shape = COLUMNS[kind];

  return (
    <div className="lib">
      <form className="seek" onSubmit={search}>
        <input
          ref={box}
          className="seekbox"
          value={query}
          placeholder={
            kind === "quests"
              ? "filter errands by name"
              : "filter by name — enter to search everything written"
          }
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

      {hits === null && (
        <div className="filters">
          {filters.map((f) => (
            <Toggle
              key={f.id}
              on={on[f.id]}
              onClick={() => setOn((s) => ({ ...s, [f.id]: !s[f.id] }))}
            >
              {f.label}
            </Toggle>
          ))}
          {active.length > 0 && (
            <Toggle className="clear" onClick={() => setOn({})}>
              clear
            </Toggle>
          )}
        </div>
      )}

      {hits !== null && <Hits named={named} hits={hits} selected={selected} onOpen={onOpen} />}
      {hits === null && reading && <Empty>reading the shelves…</Empty>}
      {hits === null && kind === "quests" && <Quests quests={rows} onOpen={onQuest} />}
      {hits === null && !reading && kind !== "quests" && (
        <Table
          cols={shape.cols}
          fields={shape.fields}
          rows={rows}
          sort={sort}
          onSort={by}
          selected={selected}
          onOpen={onOpen}
          rowClass={(r) => `${r.unwritten ? "unwritten" : ""} ${r.stub ? "stub" : ""}`.trim()}
          empty="nothing here matches"
        />
      )}
    </div>
  );
}
