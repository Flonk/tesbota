"use client";

import { Fields, Many, reader } from "./fields";
import { Tags } from "./Common";
import { RARITIES, SLOTS } from "../world";

const ITEM = [
  { key: "type", label: "type" },
  { key: "slot", label: "slot", kind: "choice", options: SLOTS },
  { key: "rarity", label: "rarity", kind: "choice", options: RARITIES },
  { key: "weight", label: "weight (stone)", kind: "number" },
  { key: "worth", label: "worth" },
  { key: "owed_by", label: "owed by" },
];

export default function ItemsEdit({ thing, draft, change }) {
  const [get, put] = reader(draft, change, "item", thing.item);
  const effects = draft.effects ?? thing.item?.effects ?? [];
  return (
    <>
      <div className="efields">
        <Fields spec={ITEM} get={get} put={put} />
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
