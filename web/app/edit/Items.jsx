"use client";

import { Field, Many, reader } from "./fields";
import { Tags } from "./Common";

const SLOTS = ["helmet", "chest", "legs", "feet", "mainhand", "offhand", "ring"];
const RARITIES = ["common", "uncommon", "rare", "epic", "legendary", "unique"];

export default function ItemsEdit({ thing, draft, change }) {
  const [get, put] = reader(draft, change, "item", thing.item);
  const effects = draft.effects ?? thing.item?.effects ?? [];
  return (
    <>
      <div className="efields">
        <Field label="type" value={get("type")} onChange={put("type")} />
        <Field label="slot" kind="choice" options={SLOTS} value={get("slot")} onChange={put("slot")} />
        <Field label="rarity" kind="choice" options={RARITIES} value={get("rarity")} onChange={put("rarity")} />
        <Field label="weight (stone)" kind="number" value={get("weight")} onChange={put("weight")} />
        <Field label="worth" value={get("worth")} onChange={put("worth")} />
        <Field label="owed by" value={get("owed_by")} onChange={put("owed_by")} />
      </div>
      <Many
        label="effects"
        rows={effects}
        onChange={(rows) => change("effects", rows)}
        columns={[
          { key: "stat", label: "stat" },
          { key: "amount", label: "amount" },
        ]}
        blank={{ stat: "", amount: "" }}
      />
      <Tags thing={thing} draft={draft} change={change} />
    </>
  );
}
