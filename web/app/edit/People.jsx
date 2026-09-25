"use client";

import { Act, Section } from "../ui";
import { Chips, Fields, reader } from "./fields";
import { Holdings, Tags } from "./Common";

const BODY = [
  { key: "health", label: "health", kind: "number" },
  { key: "damage", label: "damage" },
  { key: "dc", label: "hard to hit", kind: "number" },
  { key: "bonus", label: "swings at", kind: "number" },
  { key: "defense", label: "defense", kind: "number" },
  { key: "skill", label: "fights with" },
];

const PERSON = [
  { key: "work", label: "trade" },
  { key: "lives", label: "lives", pick: "places" },
  { key: "born", label: "born" },
  { key: "died", label: "died" },
];

const words = (text) =>
  String(text || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

function Fight({ thing, draft, change }) {
  const [get, put] = reader(draft, change, "body", thing.body);
  const has = draft.body === undefined ? !!thing.body : draft.body !== null;
  return (
    <Section label="in a fight">
      {has ? (
        <>
          <div className="efields">
            <Fields spec={BODY} get={get} put={put} />
          </div>
          <Act onClick={() => change("body", null)}>remove fight stats</Act>
        </>
      ) : (
        <Act onClick={() => change("body", {})}>add fight stats</Act>
      )}
    </Section>
  );
}

export default function PeopleEdit({ thing, draft, change }) {
  const [get, put] = reader(draft, change, "person", thing.person);
  return (
    <>
      <div className="efields">
        <Fields spec={PERSON} get={get} put={put} />
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
