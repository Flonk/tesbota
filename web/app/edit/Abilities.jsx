"use client";

import { Field, Fields, Many, reader } from "./fields";
import { Tags } from "./Common";
import { Section } from "../ui";
import { PLACE_TYPES } from "../world";

const WAITS = [
  { key: "cooldown", label: "cooldown", kind: "number" },
  { key: "sleep", label: "sleep", kind: "number" },
  { key: "delay", label: "delay", kind: "number" },
];

const CALLS = [
  { key: "name", label: "calls" },
  { key: "count", label: "count", kind: "number" },
];

const WHERE = [
  { key: "within", label: "within", pick: "places" },
  { key: "in_kind", label: "in a", kind: "choice", options: PLACE_TYPES },
  { key: "in_aspect", label: "somewhere", pick: "aspects" },
];

export default function AbilitiesEdit({ thing, draft, change }) {
  const [get, put] = reader(draft, change, "ability", thing.ability);
  const spawn = get("spawn");
  const call = (key) => (v) => {
    const next = { ...(spawn || {}), [key]: v };
    change("ability", { spawn: next.name || next.count ? next : null });
  };
  const granted = draft.granted ?? (thing.granted || []).map((a) => a.id);
  return (
    <>
      <Section label="what it does">
        <div className="efields">
          <Field label="damage" value={get("damage")} onChange={put("damage")} placeholder="2-5" />
          <Field
            kind="choice"
            label="advantage"
            options={[
              ["0", "no"],
              ["1", "yes"],
            ]}
            value={get("advantage") === null ? null : Number(get("advantage")) ? "1" : "0"}
            onChange={(v) => put("advantage")(v === "1" ? 1 : 0)}
          />
          <Fields spec={WAITS} get={get} put={put} />
          <Fields spec={CALLS} get={(key) => spawn?.[key]} put={call} />
          <Fields spec={WHERE} get={get} put={put} />
        </div>
      </Section>
      <Many
        label="granted by"
        rows={granted.map((aspect) => ({ aspect }))}
        onChange={(rows) => change("granted", rows.map((r) => r.aspect))}
        columns={[{ key: "aspect", label: "aspect", pick: "aspects" }]}
        blank={{ aspect: null }}
      />
      <Tags thing={thing} draft={draft} change={change} />
    </>
  );
}
