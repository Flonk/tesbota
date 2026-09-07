"use client";

import { Cap, Table } from "./ui";

const WORDS = { done: "done", failed: "failed", abandoned: "let go" };

const where = (q) => (q.where || []).map((p) => p.name).join(" › ");

const ONGOING = {
  cols: "minmax(9rem, 2fr) minmax(8rem, 2.4fr) minmax(6rem, 1fr) minmax(6rem, 1fr) 7rem",
  fields: [
    { key: "title", label: "errand", strong: true, cell: (q) => q.title },
    { key: "detail", label: "what it asks", dim: true, cell: (q) => q.detail || "—" },
    { key: "giver", label: "set by", dim: true, cell: (q) => q.giver || "nobody" },
    { key: "where", label: "taken on at", dim: true, cell: where },
    { key: "at", label: "opened", dim: true, cell: (q) => q.at || q.opened || "—" },
  ],
};

const FINISHED = {
  cols: "minmax(9rem, 2fr) minmax(6rem, 1fr) minmax(6rem, 1fr) 7rem",
  fields: [
    { key: "title", label: "errand", strong: true, cell: (q) => q.title },
    { key: "status", label: "outcome", dim: true, cell: (q) => WORDS[q.status] || q.status },
    { key: "where", label: "taken on at", dim: true, cell: where },
    { key: "closed", label: "closed", dim: true, cell: (q) => q.closed_at || q.closed || "—" },
  ],
};

export default function Quests({ quests = [] }) {
  const active = quests.filter((q) => q.status === "active");
  const past = quests.filter((q) => q.status !== "active");

  return (
    <div>
      <Cap>ongoing</Cap>
      <Table {...ONGOING} rows={active} empty="nothing has been taken on" />

      <Cap>finished</Cap>
      <Table {...FINISHED} rows={past} empty="nothing has been finished yet" />
    </div>
  );
}
