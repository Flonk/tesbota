"use client";

import { Cap, Crumb } from "./ui";

export default function Map({ where = [], at }) {
  const here = where[where.length - 1];
  return (
    <div className="map">
      <div className="mapframe">
        <div className="mapname">{here?.name || "nowhere in particular"}</div>
        <Crumb where={where} />
        <Cap>no map drawn yet</Cap>
      </div>
      {at && <div className="mapclock">{at}</div>}
    </div>
  );
}
