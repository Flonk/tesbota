"use client";

import { does, face, rare, tone } from "./Data";
import { Mark, openDossier, Table } from "./ui";

const RINGS = 4;

const SLOTS = ["helmet", "chest", "legs", "feet", "mainhand", "offhand"];

const CARRYING = {
  cols: "minmax(6rem, 1.3fr) minmax(6rem, 1.5fr) minmax(4rem, .8fr) 2.4rem",
  fields: [
    { key: "name", label: "carrying", strong: true,
      cell: (r) => (
        <Mark name={face(r)}>
          <span className={tone(r.rarity)}>{r.name}</span>
        </Mark>
      ) },
    { key: "does", label: "what it does", dim: true, cell: (r) => does(r) },
    { key: "rarity", label: "how often", cell: (r) => (r.rarity ? rare(r.rarity) : "") },
    { key: "qty", label: "count", num: true, cell: (r) => (r.qty === 1 ? "" : r.qty) },
  ],
};

function Slot({ slot, item }) {
  const cls = `slot slot-${slot}`;
  if (!item) {
    return (
      <div className={cls}>
        <span className="slotname">{slot}</span>
        <span className="slotitem bare">empty</span>
        <span className="slotstat" />
      </div>
    );
  }
  const said = does(item);
  const tint = tone(item.rarity);
  return (
    <button className={`${cls} worn`} onClick={() => openDossier(item.id)} title={item.name}>
      <span className="slotname">{slot}</span>
      <Mark className="slotitem" name={face(item)} gap=".3rem">
        <span className={`slottext ${tint}`}>{item.name}</span>
      </Mark>
      <span className="slotstat">{said}</span>
    </button>
  );
}

export function Doll({ inventory = [] }) {
  const worn = inventory.filter((r) => r.worn && r.slot);
  const rings = worn.filter((r) => r.slot === "ring");

  return (
    <div className="doll">
      {SLOTS.map((slot) => (
        <Slot key={slot} slot={slot} item={worn.find((r) => r.slot === slot) || null} />
      ))}
      <div className="rings">
        {Array.from({ length: RINGS }, (_, n) => (
          <Slot key={n} slot="ring" item={rings[n] || null} />
        ))}
      </div>
    </div>
  );
}

export default function Kit({ inventory = [] }) {
  return <Table {...CARRYING} rows={inventory} onOpen={openDossier} empty="it carries nothing" />;
}
