"use client";

import { Empty, Table } from "./ui";

const NAMES = {
  cols: "minmax(6rem, 1fr) minmax(5rem, 1.4fr)",
  fields: [
    { key: "name", label: "names", strong: true, cell: (r) => r.name },
    { key: "state", label: "spoken for", dim: true, cell: (r) => r.state },
  ],
};

export default function Data({ catalogue, at, draft, onDraft, boxRef }) {
  const prompt = (catalogue?.prompts || []).find((p) => p.id === at);
  const source = prompt?.source ?? prompt?.text ?? "";

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

  return (
    <textarea
      ref={boxRef}
      className="prompt"
      value={draft ?? source}
      spellCheck={false}
      onChange={(e) => onDraft(e.target.value)}
    />
  );
}
