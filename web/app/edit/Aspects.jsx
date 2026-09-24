"use client";

import { Field, Many, reader } from "./fields";
import { Tags } from "./Common";

export default function AspectsEdit({ thing, draft, change }) {
  const [get, put] = reader(draft, change, "aspect", thing.aspect);
  const grants = draft.grants ?? (thing.grants || []).map((a) => a.id);
  return (
    <>
      <div className="efields">
        <Field
          kind="choice"
          label="applies"
          options={[
            ["always", "always"],
            ["within", "within"],
          ]}
          value={get("applies")}
          onChange={put("applies")}
        />
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
