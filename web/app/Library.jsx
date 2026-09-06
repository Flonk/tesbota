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

function List({ rows }) {
  return (
    <div className="rows">
      {rows.map((r) => (
        <div className="erow" key={r.id}>
          <span className="ename">{r.name}</span>
          <span className="eid">{r.id}</span>
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
      {!reading && rows.length > 0 && kind !== "books" && <List rows={rows} />}
    </div>
  );
}
