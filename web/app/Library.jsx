"use client";

import { useEffect, useState } from "react";
import { Empty, Tag } from "./ui";

const ORDER = ["unique", "rare", "uncommon", "common", ""];
const TONE = { unique: "gold", rare: "warn", uncommon: "good", common: "dim" };
const KINDS = ["places", "people", "books", "items"];
const REMEMBER = "tesbota.library.kind";

function remembered() {
  try {
    const kind = localStorage.getItem(REMEMBER);
    return KINDS.includes(kind) ? kind : "places";
  } catch {
    return "places";
  }
}

function Shelf({ books }) {
  const sorted = [...books].sort((a, b) => ORDER.indexOf(a.rarity) - ORDER.indexOf(b.rarity));
  return (
    <div className="shelf">
      {sorted.map((b) => (
        <div className="book" key={b.id}>
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

const COUNT = (n) => (n ? String(n) : "");

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

function List({ kind, rows }) {
  const [sort, setSort] = useState({ key: "name", dir: 1 });
  const shape = COLUMNS[kind];
  if (!shape) return null;

  const sorted = [...rows].sort(
    (a, b) => compare(a, b, sort.key) * sort.dir || compare(a, b, "name")
  );

  function by(key) {
    setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));
  }

  return (
    <div className="etable" style={{ "--cols": shape.cols }}>
      <div className="erow ehead">
        {shape.fields.map((f) => (
          <button
            key={f.key}
            className={`ecol${f.num ? " num" : ""}${sort.key === f.key ? " on" : ""}`}
            onClick={() => by(f.key)}
          >
            {f.label}
            {sort.key === f.key && <span className="dir">{sort.dir > 0 ? "\u2191" : "\u2193"}</span>}
          </button>
        ))}
      </div>
      {sorted.map((r) => (
        <div
          key={r.id}
          className={`erow${r.unwritten ? " unwritten" : ""}${r.stub ? " stub" : ""}`}
          title={r.id}
        >
          {shape.fields.map((f) => (
            <span
              key={f.key}
              className={`ecell${f.num ? " num" : ""}${f.dim ? " dim" : ""}${f.key === "name" ? " ename" : ""}`}
            >
              {f.cell(r)}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function Library() {
  const [books, setBooks] = useState(null);
  const [world, setWorld] = useState(null);
  const [kind, setKind] = useState(remembered);

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

  function pick(next) {
    setKind(next);
    try {
      localStorage.setItem(REMEMBER, next);
    } catch {}
  }

  const shelf = books || [];
  const counts = {
    places: (world?.places || []).length,
    people: (world?.people || []).length,
    books: shelf.length,
    items: (world?.items || []).length,
  };
  const rows = kind === "books" ? shelf : world?.[kind] || [];
  const reading = books === null || world === null;

  return (
    <div className="lib">
      <div className="subbar">
        {KINDS.map((k) => (
          <button key={k} className={`subtab${kind === k ? " on" : ""}`} onClick={() => pick(k)}>
            {k}
            <span className="count">{counts[k]}</span>
          </button>
        ))}
      </div>

      {reading && <Empty>reading the shelves…</Empty>}
      {!reading && rows.length === 0 && <Empty>nothing written yet</Empty>}
      {!reading && rows.length > 0 && kind === "books" && <Shelf books={shelf} />}
      {!reading && rows.length > 0 && kind !== "books" && <List kind={kind} rows={rows} />}
    </div>
  );
}
