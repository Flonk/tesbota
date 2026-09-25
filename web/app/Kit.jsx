"use client";

import { does, face, lit, SLOTS } from "./world";
import { Mark, openDossier, rated, Table, tint } from "./ui";

const RINGS = 4;

const CARRYING = {
  cols: "minmax(6rem, 1.4fr) minmax(6rem, 1.4fr) 3.4rem 2.4rem",
  fields: [
    { key: "name", label: "carrying", strong: true,
      cell: (r) => (
        <Mark name={face(r)} tone={lit(r)}>
          {r.name}
        </Mark>
      ) },
    { key: "does", label: "what it does", dim: true, cell: (r) => does(r) },
    { key: "weight", label: "stone", num: true, dim: true,
      cell: (r) => (r.weight ? +(r.weight * (r.qty > 0 ? r.qty : 1)).toFixed(2) : "") },
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
  return (
    <button className={`${cls} worn`} onClick={() => openDossier(item.id)} title={item.name}>
      <span className="slotname">{slot}</span>
      <Mark className="slotitem" name={face(item)} gap=".3rem">
        <span className={`slottext ${tint(item.rarity)}`}>{item.name}</span>
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
      {SLOTS.filter((slot) => slot !== "ring").map((slot) => (
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
  return <Table rarity={rated} {...CARRYING} rows={inventory} onOpen={openDossier} empty="it carries nothing" />;
}
