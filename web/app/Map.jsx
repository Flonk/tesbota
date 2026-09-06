"use client";

export default function Map({ where = [], at }) {
  const here = where[where.length - 1];
  return (
    <div className="map">
      <div className="mapframe">
        <div className="mapname">{here?.name || "nowhere in particular"}</div>
        <div className="mappath">
          {where.map((p, n) => (
            <span key={p.id || n}>
              {n > 0 && <span className="sep">›</span>}
              {p.name}
            </span>
          ))}
        </div>
        <div className="mapnone">no map drawn yet</div>
      </div>
      {at && <div className="mapclock">{at}</div>}
    </div>
  );
}
