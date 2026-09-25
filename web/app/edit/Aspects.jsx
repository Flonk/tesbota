"use client";

import { Fields, Many, reader } from "./fields";
import { Tags } from "./Common";

const ASPECT = [{ key: "applies", label: "applies", kind: "choice", options: ["always", "within"] }];

export default function AspectsEdit({ thing, draft, change }) {
  const [get, put] = reader(draft, change, "aspect", thing.aspect);
  const grants = draft.grants ?? (thing.grants || []).map((a) => a.id);
  return (
    <>
      <div className="efields">
        <Fields spec={ASPECT} get={get} put={put} />
      </div>
      <Many
        label="grants"
        rows={grants.map((ability) => ({ ability }))}
        onChange={(rows) => change("grants", rows.map((r) => r.ability))}
        columns={[{ key: "ability", label: "ability", pick: "abilities" }]}
        blank={{ ability: null }}
      />
      <Tags thing={thing} draft={draft} change={change} />
    </>
  );
}
