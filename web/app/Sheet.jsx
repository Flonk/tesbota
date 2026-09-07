"use client";

import { Cap, Table } from "./ui";

const SKILL_ABILITY = {
  acrobatics: "dex",
  "animal handling": "wis",
  arcana: "int",
  athletics: "str",
  deception: "cha",
  history: "int",
  insight: "wis",
  intimidation: "cha",
  investigation: "int",
  medicine: "wis",
  nature: "int",
  perception: "wis",
  performance: "cha",
  persuasion: "cha",
  religion: "int",
  "sleight of hand": "dex",
  stealth: "dex",
  survival: "wis",
};

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

const mod = (score) => Math.floor((Number(score ?? 10) - 10) / 2);
const sign = (n) => (n >= 0 ? `+${n}` : `${n}`);

const CONDITION = {
  cols: "minmax(6rem, 1fr) 4rem 5rem",
  fields: [
    { key: "name", strong: true, cell: (r) => r.name },
    { key: "value", num: true, cell: (r) => r.value },
    { key: "max", dim: true, cell: () => "of 100" },
  ],
};

const ABILITY = {
  cols: "minmax(6rem, 1fr) 4rem 4rem",
  fields: [
    { key: "name", strong: true, cell: (r) => r.name },
    { key: "score", num: true, cell: (r) => r.score },
    { key: "mod", num: true, cell: (r) => sign(r.mod) },
  ],
};

const SKILLS = {
  cols: "minmax(8rem, 1fr) 4rem 4rem",
  fields: [
    { key: "name", label: "skill", strong: true, cell: (r) => r.name },
    { key: "ability", label: "from", dim: true, cell: (r) => r.ability },
    { key: "bonus", label: "bonus", num: true, cell: (r) => sign(r.bonus) },
  ],
};

const CARRYING = {
  cols: "minmax(8rem, 1.4fr) 4rem minmax(6rem, 2fr) 4rem",
  fields: [
    { key: "name", label: "thing", strong: true, cell: (r) => r.name },
    { key: "qty", label: "count", num: true, cell: (r) => (r.qty > 1 ? r.qty : "") },
    { key: "note", label: "condition", dim: true, cell: (r) => r.note || "—" },
    { key: "worn", label: "worn", dim: true, cell: (r) => (r.worn ? "worn" : "") },
  ],
};

const NOTEBOOK = {
  cols: "1fr",
  fields: [{ key: "line", strong: true, cell: (r) => r.line }],
};

export default function Sheet({ vitals, skills, inventory = [], notebook = [] }) {
  const abilities = skills?.abilities || {};
  const proficient = new Set(skills?.proficient || []);
  const bonus = Number(skills?.proficiency || 0);

  const condition = [
    { name: "health", value: vitals?.health ?? 100 },
    { name: "fatigue", value: vitals?.fatigue ?? 0 },
    { name: "hunger", value: vitals?.hunger ?? 0 },
  ];

  const scores = ABILITIES.map((a) => ({
    name: a,
    score: abilities[a] ?? 10,
    mod: mod(abilities[a]),
  }));

  const trained = Object.keys(SKILL_ABILITY)
    .sort()
    .map((name) => ({
      name,
      ability: SKILL_ABILITY[name],
      bonus: mod(abilities[SKILL_ABILITY[name]]) + (proficient.has(name) ? bonus : 0),
      trained: proficient.has(name),
    }));

  return (
    <div className="cols">
      <div>
        <Cap>condition</Cap>
        <Table {...CONDITION} rows={condition} />

        <Cap>abilities</Cap>
        <Table {...ABILITY} rows={scores} />

        <Cap>carrying</Cap>
        <Table
          {...CARRYING}
          rows={inventory.map((i, n) => ({ ...i, id: `${i.name}-${n}` }))}
          empty="it carries nothing"
        />
      </div>

      <div>
        <Cap>notebook</Cap>
        <Table
          {...NOTEBOOK}
          rows={notebook.map((line, n) => ({ id: n, line }))}
          empty="nothing written"
        />

        <Cap>skills</Cap>
        <Table {...SKILLS} rows={trained} rowClass={(r) => (r.trained ? "trained" : "untrained")} />
      </div>
    </div>
  );
}
