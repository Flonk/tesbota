"use client";

import { useEffect, useState } from "react";

const ORDER = ["unique", "rare", "uncommon", "common", ""];

export default function Library({ onClose }) {
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
  const sorted = [...shelf].sort(
    (a, b) => ORDER.indexOf(a.rarity) - ORDER.indexOf(b.rarity)
  );

  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheethead">
          <h2>the library</h2>
          <button className="ghost" onClick={onClose}>close</button>
        </div>

        {books === null && <p className="empty">reading the shelves…</p>}
        {books !== null && shelf.length === 0 && <p className="empty">nothing written yet</p>}

        {sorted.map((b) => (
          <div className="book" key={b.id}>
            <div className="btitle">
              {b.name}
              {b.godhead && <span className="godhead">godhead</span>}
            </div>
            <div className="bline">
              <span className="bauthor">{b.author || "unattributed"}</span>
              <span className="bdate">[{b.written || "—"}]</span>
              {b.rarity && <span className={`brarity r-${b.rarity}`}>{b.rarity}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
