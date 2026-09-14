"use client";

import { shortDate, timeOf } from "./clock";
import { Cap, Crumb, Empty, openDossier, Overlay, Prose, Table, Tag } from "./ui";

const WORDS = { done: "done", failed: "failed", abandoned: "let go" };
const TONE = { done: "good", failed: "warn", abandoned: "dim" };

const name = (id) => String(id || "").replace(/-/g, " ");

const COLUMNS = {
  cols: "minmax(7rem, 3fr) minmax(4.5rem, 1.4fr) 6rem",
  fields: [
    { key: "title", label: "errand", strong: true, cell: (q) => q.title },
    { key: "giver", label: "set by", dim: true, cell: (q) => name(q.giver) || "nobody" },
    { key: "at", label: "opened", dim: true, cell: (q) => shortDate(q.at || q.opened) },
  ],
};

const FINISHED = {
  ...COLUMNS,
  fields: [
    COLUMNS.fields[0],
    COLUMNS.fields[1],
    {
      key: "closed_at",
      label: "closed",
      dim: true,
      cell: (q) => shortDate(q.closed_at || q.closed),
    },
  ],
};

export function QuestPanel({ quest, onClose }) {
  if (!quest) return null;
  const finished = quest.status !== "active";
  return (
    <Overlay
      onClose={onClose}
      face="flag"
      title={quest.title}
      under={<span className="cap dmeta">{quest.id}</span>}
      tags={
        <Tag tone={finished ? TONE[quest.status] || "dim" : "gold"}>
          {finished ? WORDS[quest.status] || quest.status : "ongoing"}
        </Tag>
      }
    >
      <div className="dbody">
        <div className="dsec">
          <p className="cap">what it asks</p>
          {quest.detail ? (
            <Prose className="dclaimtext" text={quest.detail} />
          ) : (
            <Empty>nothing was written down about it</Empty>
          )}
        </div>

        {quest.script && (
          <div className="dsec">
            <p className="cap">script — the game master sees this, the adventurer never does</p>
            <pre className="prompt">{quest.script}</pre>
          </div>
        )}

        <div className="dsec">
          <p className="cap">set by</p>
          {quest.giver ? (
            <p className="dline">
              <button className="dlink" onClick={() => openDossier(quest.giver)}>
                {name(quest.giver)}
              </button>
            </p>
          ) : (
            <Empty>nobody is recorded as having asked</Empty>
          )}
        </div>

        <div className="dsec">
          <p className="cap">taken on at</p>
          {quest.where?.length ? <Crumb where={quest.where} /> : <Empty>nowhere recorded</Empty>}
        </div>

        <div className="dsec">
          <p className="cap">when</p>
          <p className="dline">
            <span>opened {shortDate(quest.at || quest.opened)}</span>
            <span className="dsection">{timeOf(quest.at)}</span>
            <span className="dsection">{quest.opened}</span>
          </p>
          {finished && (
            <p className="dline">
              <span>closed {shortDate(quest.closed_at || quest.closed)}</span>
              <span className="dsection">{timeOf(quest.closed_at)}</span>
              <span className="dsection">{quest.closed}</span>
            </p>
          )}
        </div>
      </div>
    </Overlay>
  );
}

export default function Quests({ quests = [], onOpen }) {
  const active = quests.filter((q) => q.status === "active");
  const past = quests.filter((q) => q.status !== "active");

  return (
    <div>
      <Cap>ongoing</Cap>
      <Table {...COLUMNS} rows={active} onOpen={onOpen} empty="nothing has been taken on" />

      <Cap>finished</Cap>
      <Table {...FINISHED} rows={past} onOpen={onOpen} empty="nothing has been finished yet" />
    </div>
  );
}
