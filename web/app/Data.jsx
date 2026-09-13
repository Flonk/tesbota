"use client";

import { useEffect, useRef, useState } from "react";
import { Btn, Empty, Table } from "./ui";

const NAMES = {
  cols: "minmax(6rem, 1fr) minmax(5rem, 1.4fr)",
  fields: [
    { key: "name", label: "names", strong: true, cell: (r) => r.name },
    { key: "state", label: "spoken for", dim: true, cell: (r) => r.state },
  ],
};

export default function Data({ catalogue, at, onSave }) {
  const box = useRef(null);
  const [draft, setDraft] = useState(null);
  const prompt = (catalogue?.prompts || []).find((p) => p.id === at);
  const source = prompt?.source ?? prompt?.text ?? "";

  useEffect(() => {
    setDraft(null);
  }, [at]);

  if (!catalogue) return <Empty>reading the machine…</Empty>;
  if (catalogue.error) return <Empty>{catalogue.error}</Empty>;

  if (at === "names") {
    const { surname, current, pool = [] } = catalogue.names || {};
    const given = String(current || "").split(" ")[0].toLowerCase();
    const rows = pool.map((entry) => ({
      id: entry.name,
      name: `${entry.name} ${surname}`,
      state: entry.name.toLowerCase() === given ? "walking" : entry.taken ? "spoken for" : "",
      taken: entry.taken,
    }));
    return (
      <Table
        {...NAMES}
        rows={rows}
        rowClass={(r) => (r.taken ? "untrained" : "")}
        empty="no names to draw from"
      />
    );
  }

  if (!prompt) return <Empty>nothing under that name</Empty>;

  const text = draft ?? source;
  const dirty = draft !== null && draft !== source;

  function put(line) {
    const el = box.current;
    const cut = el ? el.selectionStart : text.length;
    const before = text.slice(0, cut).replace(/\n*$/, "");
    const after = text.slice(cut).replace(/^\n*/, "");
    setDraft(`${before}\n\n${line}\n\n${after}`);
  }

  return (
    <div className="editor">
      <textarea
        ref={box}
        className="prompt"
        value={text}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="actions left">
        <Btn tone={dirty ? "gold" : "plain"} disabled={!dirty} onClick={() => onSave(at, text)}>
          save
        </Btn>
        <Btn disabled={!dirty} onClick={() => setDraft(null)}>
          abort
        </Btn>
        <Btn onClick={() => put("→ common")}>link common</Btn>
        <Btn onClick={() => put("→ writing")}>link writing</Btn>
      </div>
    </div>
  );
}
