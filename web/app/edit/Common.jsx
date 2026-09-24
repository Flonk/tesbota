"use client";

import { Many } from "./fields";

export function Tags({ thing, draft, change }) {
  const rows = draft.tags ?? (thing.aspects || []).map((a) => ({ aspect: a.aspect, value: a.value }));
  return (
    <Many
      label="aspects"
      rows={rows}
      onChange={(v) => change("tags", v)}
      columns={[
        { key: "aspect", label: "aspect", pick: "aspects" },
        { key: "value", label: "of" },
      ]}
      blank={{ aspect: null, value: null }}
    />
  );
}

export function Holdings({ thing, draft, change }) {
  if (thing.kind !== "people" && thing.kind !== "places") return null;
  const saved = draft.holdings ?? (thing.holdings || []).map((h) => ({ item: h.id ?? h.item, qty: h.qty, worn: h.worn ? 1 : 0 }));
  const rows = saved.map((h) => ({ ...h, worn: h.worn ? "1" : null }));
  return (
    <Many
      label="inventory"
      rows={rows}
      onChange={(v) => change("holdings", v.map((h) => ({ item: h.item, qty: h.qty, worn: h.worn ? 1 : 0 })))}
      columns={[
        { key: "item", label: "item", pick: "items" },
        { key: "qty", label: "count", kind: "number" },
        { key: "worn", label: "worn", kind: "choice", options: [["1", "worn"]] },
      ]}
      blank={{ item: null, qty: 1, worn: null }}
    />
  );
}
