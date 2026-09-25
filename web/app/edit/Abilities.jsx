"use client";

import { Field, Group, Many, Pick, reader } from "./fields";
import { Tags } from "./Common";
import { PLACE_TYPES } from "../world";

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
      <Group label="what it does">
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
          <Field kind="number" label="cooldown" value={get("cooldown")} onChange={put("cooldown")} />
          <Field kind="number" label="sleep" value={get("sleep")} onChange={put("sleep")} />
          <Field kind="number" label="delay" value={get("delay")} onChange={put("delay")} />
          <Field label="calls" value={spawn?.name} onChange={call("name")} />
          <Field kind="number" label="count" value={spawn?.count} onChange={call("count")} />
          <Pick label="within" kind="places" value={get("within")} onChange={put("within")} />
          <Field kind="choice" label="in a" options={PLACE_TYPES} value={get("in_kind")} onChange={put("in_kind")} />
          <Pick label="somewhere" kind="aspects" value={get("in_aspect")} onChange={put("in_aspect")} />
        </div>
      </Group>
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
