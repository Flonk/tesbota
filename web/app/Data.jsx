"use client";

import Icon from "./icons";
import { Empty, openDossier, Table } from "./ui";

const NAMES = {
  cols: "minmax(6rem, 1fr) minmax(5rem, 1.4fr)",
  fields: [
    { key: "name", label: "names", strong: true, cell: (r) => r.name },
    { key: "state", label: "spoken for", dim: true, cell: (r) => r.state },
  ],
};

export const ICON = {
  weapon: "sword", apparel: "shirt", consumable: "flask", tool: "hammer", valuable: "coin", material: "sack",
};

export const rare = (name) => (
  <span className={`rare-${name}`}>{String(name || "").replace(/_/g, " ")}</span>
);

const TRAITS = {
  cols: "minmax(9rem, 2fr) 6rem",
  fields: [
    { key: "trait", label: "personality", strong: true, cell: (r) => r.trait },
    { key: "rarity", label: "how often", cell: (r) => rare(r.rarity) },
  ],
};

const ITEMS = {
  cols: "1.1rem minmax(6rem, 1fr) minmax(8rem, 1.6fr) minmax(6rem, 1.2fr)",
  fields: [
    { key: "icon", label: "", cell: (r) => <Icon name={r.icon} /> },
    { key: "type", label: "item", strong: true, cell: (r) => r.type },
    { key: "stats", label: "what it carries", dim: true, cell: (r) => r.stats },
    { key: "slots", label: "slot", dim: true, cell: (r) => (r.slots || []).join(", ") },
  ],
};

const KIT = {
  cols: "1.1rem minmax(6rem, 1.3fr) minmax(6rem, 1.2fr) minmax(6rem, 1.4fr)",
  fields: [
    { key: "icon", label: "", cell: (r) => <Icon name={ICON[r.type]} /> },
    { key: "name", label: "they start with", strong: true, cell: (r) => r.name },
    { key: "effect", label: "what it does", cell: (r) => r.effect || "" },
    { key: "note", label: "condition", dim: true, cell: (r) => r.note || "" },
  ],
};

const RARITY = {
  cols: "minmax(6rem, 1fr) 5rem 3rem",
  fields: [
    { key: "rarity", label: "rarity", cell: (r) => rare(r.rarity) },
    { key: "weight", label: "weight", num: true, cell: (r) => r.weight },
    { key: "swatch", label: "", cell: (r) => <span className={`swatch rare-${r.rarity}`} /> },
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

  if (at === "items") {
    const rows = (catalogue.items || []).map((r) => ({ ...r, id: r.type }));
    return <Table {...ITEMS} rows={rows} empty="no kinds of thing yet" />;
  }

  if (at === "kit") {
    return (
      <Table
        {...KIT}
        rows={catalogue.kit || []}
        onOpen={openDossier}
        empty="they start with nothing"
      />
    );
  }

  if (at === "rarity") {
    const rows = (catalogue.rarity || []).map((r) => ({ ...r, id: r.rarity }));
    return <Table {...RARITY} rows={rows} empty="no ladder" />;
  }

  if (at === "personality") {
    const rows = (catalogue.personality || []).map((r) => ({ ...r, id: r.trait }));
    return <Table {...TRAITS} rows={rows} empty="nobody is anybody yet" />;
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
