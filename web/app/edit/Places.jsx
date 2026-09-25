"use client";

import { Fields, Many, reader } from "./fields";
import { Tags } from "./Common";
import { Section } from "../ui";
import { isRun, PLACE_TYPES } from "../world";

const CELESTIAL = ["celestial-body", "celestial-system"];

const PLACE = [
  { key: "type", label: "type", kind: "choice", options: PLACE_TYPES },
  { key: "parent", label: "inside", pick: "places" },
  { key: "lat", label: "latitude", kind: "number" },
  { key: "lon", label: "longitude", kind: "number" },
];

const RUN = [{ key: "width", label: "width in metres", kind: "number" }];

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
].map(([key, label]) => ({ key, label, kind: "number" }));

const WAYS = [{ key: "dst", label: "leads into", pick: "places" }];

export default function PlacesEdit({ thing, draft, change }) {
  const [get, put] = reader(draft, change, "place", thing.place);
  const [orbit, putOrbit] = reader(draft, change, "orbit", thing.orbit);
  const type = get("type");
  const ways =
    draft.ways ?? (thing.exits || []).map((w) => ({ dst: w.id }));
  return (
    <>
      <div className="efields">
        <Fields spec={PLACE} get={get} put={put} />
        {isRun(type) && <Fields spec={RUN} get={get} put={put} />}
      </div>
      {CELESTIAL.includes(type) && (
        <Section label="orbit">
          <div className="efields">
            <Fields spec={ORBIT} get={orbit} put={putOrbit} />
          </div>
        </Section>
      )}
      <Many
        label="doors"
        rows={ways}
        onChange={(rows) => change("ways", rows)}
        columns={WAYS}
        blank={{ dst: null }}
        empty="no doors"
      />
      <Tags thing={thing} draft={draft} change={change} />
    </>
  );
}
