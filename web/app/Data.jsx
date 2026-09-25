"use client";

import { useRef, useState } from "react";
import { useJSON } from "./http";
import { face, given, lit, rare } from "./world";
import { Act, Empty, Mark, openDossier, rated, Row, Table, Tabs, unrated } from "./ui";

const LAYER_ICON = {
  common: "lines",
  writing: "pen",
  explorer: "person",
  gm: "dice",
  propose: "dice",
  lore1: "lines",
  lore2: "scales",
  queries: "scales",
  lore3: "silence",
  lore4: "pen",
};

const LISTS = [
  { id: "names", label: "names", icon: "people" },
  { id: "personality", label: "personality", icon: "pulse" },
  { id: "rarity", label: "rarity", icon: "dice" },
  { id: "places", label: "places", icon: "pin" },
  { id: "items", label: "items", icon: "box" },
  { id: "kit", label: "kit", icon: "shirt" },
];

const opened = { lists: "names", prompts: "common" };
const drafts = {};

const NAMES = {
  cols: "minmax(6rem, 1fr) minmax(5rem, 1.4fr)",
  fields: [
    { key: "name", label: "names", strong: true, cell: (r) => r.name },
    { key: "state", label: "spoken for", dim: true, cell: (r) => r.state },
  ],
};

const TRAITS = {
  cols: "minmax(9rem, 2fr) 6rem",
  fields: [
    { key: "trait", label: "personality", strong: true, cell: (r) => r.trait },
    { key: "rarity", label: "how often", cell: (r) => rare(r.rarity) },
  ],
};

const PLACES = {
  cols: "minmax(8rem, 1fr) minmax(10rem, 2.2fr)",
  fields: [
    { key: "type", label: "place", strong: true,
      cell: (r) => <Mark name={r.icon}>{r.type.replace(/-/g, " ")}</Mark> },
    { key: "what", label: "what it is", dim: true, cell: (r) => r.what },
  ],
};

const ITEMS = {
  cols: "minmax(9rem, 1.2fr) minmax(8rem, 1.6fr)",
  fields: [
    { key: "type", label: "item", strong: true,
      cell: (r) => <Mark name={r.icon}>{r.label}</Mark> },
    { key: "stats", label: "what it carries", dim: true, cell: (r) => r.stats },
  ],
};

const KIT = {
  cols: "minmax(7rem, 1.3fr) minmax(6rem, 1.4fr)",
  fields: [
    { key: "name", label: "they start with", strong: true,
      cell: (r) => (
        <Mark name={face(r)} tone={lit(r)}>
          {r.name}
        </Mark>
      ) },
    { key: "effect", label: "what it does", cell: (r) => r.effect || "" },
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

function List({ catalogue, at }) {
  if (at === "names") {
    const { surname, current, pool = [] } = catalogue.names || {};
    const walking = given(current).toLowerCase();
    const rows = pool.map((entry) => ({
      id: entry.name,
      name: `${entry.name} ${surname}`,
      state: entry.name.toLowerCase() === walking ? "walking" : entry.taken ? "spoken for" : "",
      taken: entry.taken,
    }));
    return (
      <Table
        rarity={unrated}
        {...NAMES}
        rows={rows}
        rowClass={(r) => (r.taken ? "untrained" : "")}
        empty="no names to draw from"
      />
    );
  }

  if (at === "places") {
    const rows = (catalogue.places || []).map((r) => ({ ...r, id: r.type }));
    return <Table rarity={unrated} {...PLACES} rows={rows} empty="no sorts of place yet" />;
  }

  if (at === "items") {
    const rows = [];
    for (const kind of catalogue.items || []) {
      rows.push({ ...kind, id: kind.type, label: kind.type });
      for (const slot of kind.type === "apparel" ? kind.slots || [] : []) {
        rows.push({
          id: `${kind.type}:${slot.slot}`,
          label: `${kind.type}:${slot.slot}`,
          icon: slot.icon,
          stats: kind.stats,
          slot: slot.slot,
          under: true,
        });
      }
    }
    return <Table rarity={unrated} {...ITEMS} rows={rows} rowClass={(r) => (r.under ? "under" : "")} empty="no kinds of thing yet" />;
  }

  if (at === "kit") {
    return (
      <Table
        rarity={rated}
        {...KIT}
        rows={catalogue.kit || []}
        onOpen={openDossier}
        empty="they start with nothing"
      />
    );
  }

  if (at === "rarity") {
    const rows = (catalogue.rarity || []).map((r) => ({ ...r, id: r.rarity }));
    return <Table rarity={rated} {...RARITY} rows={rows} empty="no ladder" />;
  }

  if (at === "personality") {
    const rows = (catalogue.personality || []).map((r) => ({ ...r, id: r.trait }));
    return <Table rarity={rated} {...TRAITS} rows={rows} empty="nobody is anybody yet" />;
  }
}

export default function Data({ sheaf, onPost }) {
  const { data: catalogue, error, reload } = useJSON("/api/data");
  const [, redraw] = useState(0);
  const pen = useRef(null);
  const at = opened[sheaf];
  const prompt = (catalogue?.prompts || []).find((p) => p.id === at);
  const draft = drafts[at] ?? null;
  const text = draft ?? prompt?.source ?? "";

  const write = (id, next) => {
    if (next === null) delete drafts[id];
    else drafts[id] = next;
    redraw((n) => n + 1);
  };

  const save = async () => {
    if (draft === null) return;
    const { ok } = await onPost("/api/prompt", { id: at, text: draft }, "prompt");
    if (!ok) return;
    await reload();
    if (drafts[at] === draft) write(at, null);
  };

  const link = (line) => {
    const cut = pen.current ? pen.current.selectionStart : text.length;
    write(at, `${text.slice(0, cut).replace(/\n*$/, "")}\n\n${line}\n\n${text.slice(cut).replace(/^\n*/, "")}`);
  };

  let body = null;
  if (error) body = <Empty>the machine did not answer — {error}</Empty>;
  else if (!catalogue) body = <Empty>reading the machine…</Empty>;
  else if (sheaf === "lists") body = <List catalogue={catalogue} at={at} />;
  else if (!prompt) body = <Empty>nothing under that name</Empty>;

  return (
    <div className="lib">
      <Tabs
        sub
        items={
          sheaf === "lists"
            ? LISTS
            : (catalogue?.prompts || []).map((p) => ({ id: p.id, label: p.label, icon: LAYER_ICON[p.id] || "lines" }))
        }
        value={at}
        onChange={(next) => {
          opened[sheaf] = next;
          redraw((n) => n + 1);
        }}
      />
      {sheaf === "prompts" && (
        <Row>
          <Act className="keep" onClick={save} disabled={draft === null}>
            save
          </Act>
          <Act onClick={() => write(at, null)} disabled={draft === null}>
            abort
          </Act>
          <Act onClick={() => link("$COMMON")}>link common</Act>
          <Act onClick={() => link("$WRITING")}>link writing</Act>
        </Row>
      )}
      {body ? (
        <div className="libbody">{body}</div>
      ) : (
        <textarea
          ref={pen}
          className="prompt"
          value={text}
          spellCheck={false}
          onChange={(e) => write(at, e.target.value)}
        />
      )}
    </div>
  );
}
