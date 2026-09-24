"use client";

import { Field, Group, Many, Pick, reader } from "./fields";
import { Tags } from "./Common";

const TYPES = ["location", "region", "road", "river", "water", "celestial-body", "celestial-system", "realm"];
const CELESTIAL = ["celestial-body", "celestial-system"];

const ORBIT = [
  ["semi_major", "semi-major axis (m)"],
  ["eccentricity", "eccentricity"],
  ["longitude", "longitude (°)"],
  ["periapsis", "periapsis (°)"],
  ["mass", "mass (kg)"],
  ["radius", "radius (m)"],
  ["oblateness", "oblateness"],
  ["tilt", "axial tilt (°)"],
  ["rotation", "sidereal rotation (s)"],
  ["meridian", "meridian (°)"],
];

const WAYS = [
  { key: "dst", label: "to", pick: "places" },
  { key: "bearing", label: "bearing" },
  { key: "distance", label: "how far" },
];

export default function PlacesEdit({ thing, draft, change }) {
  const [get, put] = reader(draft, change, "place", thing.place);
  const [orbit, putOrbit] = reader(draft, change, "orbit", thing.orbit);
  const type = get("type");
  const ways =
    draft.ways ?? (thing.exits || []).map((w) => ({ dst: w.id, bearing: w.bearing ?? "", distance: w.distance ?? "" }));
  return (
    <>
      <div className="efields">
        <Field kind="choice" label="type" options={TYPES} value={type} onChange={put("type")} />
        <Pick kind="places" label="inside" value={get("parent")} onChange={put("parent")} />
        <Field kind="number" label="latitude" value={get("lat")} onChange={put("lat")} />
        <Field kind="number" label="longitude" value={get("lon")} onChange={put("lon")} />
        {(type === "road" || type === "river") && (
          <Field kind="number" label="width in metres" value={get("width")} onChange={put("width")} />
        )}
      </div>
      {CELESTIAL.includes(type) && (
        <Group label="orbit">
          <div className="efields">
            {ORBIT.map(([key, label]) => (
              <Field key={key} kind="number" label={label} value={orbit(key)} onChange={putOrbit(key)} />
            ))}
          </div>
        </Group>
      )}
      <Many
        label="ways out"
        rows={ways}
        onChange={(rows) => change("ways", rows)}
        columns={WAYS}
        blank={{ dst: null, bearing: "", distance: "" }}
      />
      <Tags thing={thing} draft={draft} change={change} />
    </>
  );
}
