"use client";

import { face } from "./Data";
import Icon from "./icons";
import { openDossier, Table } from "./ui";

const RINGS = 4;

const SLOTS = ["helmet", "chest", "legs", "feet", "mainhand", "offhand"];

const CARRYING = {
  cols: "minmax(7rem, 2fr) 3rem minmax(4.5rem, 1.2fr)",
  fields: [
    { key: "name", label: "carrying", strong: true, cell: (r) => r.name },
    { key: "qty", label: "count", num: true, cell: (r) => (r.qty === 1 ? "" : r.qty) },
    { key: "note", label: "condition", dim: true, cell: (r) => r.note || "—" },
  ],
};

function Slot({ slot, item }) {
  const cls = `slot slot-${slot}`;
  if (!item) {
    return (
      <div className={cls}>
        <span className="slotname">{slot}</span>
        <span className="slotitem bare">empty</span>
      </div>
    );
  }
  return (
    <button className={`${cls} worn`} onClick={() => openDossier(item.id)} title={item.name}>
      <span className="slotname">{slot}</span>
      <span className="slotitem">
        <Icon name={face(item)} />
        <span className="slottext">{item.name}</span>
      </span>
    </button>
  );
}

export default function Kit({ inventory = [] }) {
  const worn = inventory.filter((r) => r.worn && r.slot);
  const rings = worn.filter((r) => r.slot === "ring");

  return (
    <div className="pair kit">
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

      <Table {...CARRYING} rows={inventory} onOpen={openDossier} empty="it carries nothing" />
    </div>
  );
}
