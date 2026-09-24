"use client";

import { Act } from "../ui";
import { Chips, Field, Group, Pick, reader } from "./fields";
import { Holdings, Tags } from "./Common";

const words = (text) =>
  String(text || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

function Fight({ thing, draft, change }) {
  const [get, put] = reader(draft, change, "body", thing.body);
  const has = draft.body === undefined ? !!thing.body : draft.body !== null;
  return (
    <Group label="in a fight">
      {has ? (
        <>
          <div className="efields">
            <Field kind="number" label="health" value={get("health")} onChange={put("health")} />
            <Field label="damage" value={get("damage")} onChange={put("damage")} />
            <Field kind="number" label="hard to hit" value={get("dc")} onChange={put("dc")} />
            <Field kind="number" label="swings at" value={get("bonus")} onChange={put("bonus")} />
            <Field kind="number" label="defense" value={get("defense")} onChange={put("defense")} />
            <Field label="fights with" value={get("skill")} onChange={put("skill")} />
          </div>
          <Act onClick={() => change("body", null)}>remove fight stats</Act>
        </>
      ) : (
        <Act onClick={() => change("body", {})}>add fight stats</Act>
      )}
    </Group>
  );
}

export default function PeopleEdit({ thing, draft, change }) {
  const [get, put] = reader(draft, change, "person", thing.person);
  return (
    <>
      <div className="efields">
        <Field label="trade" value={get("work")} onChange={put("work")} />
        <Pick label="lives" kind="places" value={get("lives")} onChange={put("lives")} />
        <Field label="born" value={get("born")} onChange={put("born")} />
        <Field label="died" value={get("died")} onChange={put("died")} />
      </div>
      <Tags thing={thing} draft={draft} change={change} />
      <Fight thing={thing} draft={draft} change={change} />
      <Chips
        label="personality"
        values={words(get("traits"))}
        onChange={(list) => change("person", { traits: list.join(", ") })}
      />
      <Holdings thing={thing} draft={draft} change={change} />
    </>
  );
}
