"use client";

import { useEffect, useState } from "react";
import { Empty, Tag } from "./ui";

const ORDER = ["unique", "rare", "uncommon", "common", ""];
const TONE = { unique: "gold", rare: "warn", uncommon: "good", common: "dim" };

export default function Library() {
  const [books, setBooks] = useState(null);

  useEffect(() => {
    let live = true;
    fetch("/api/library", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((b) => live && setBooks(b))
      .catch(() => live && setBooks([]));
    return () => {
      live = false;
    };
  }, []);

  const shelf = books || [];
  const sorted = [...shelf].sort((a, b) => ORDER.indexOf(a.rarity) - ORDER.indexOf(b.rarity));

  return (
    <div className="shelf">
      {books === null && <Empty>reading the shelves…</Empty>}
      {books !== null && shelf.length === 0 && <Empty>nothing written yet</Empty>}

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
