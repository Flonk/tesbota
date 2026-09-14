"use client";

import { Table } from "./ui";

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
  cols: "minmax(4rem, 1fr) 3rem",
  fields: [
    { key: "name", label: "condition", strong: true, cell: (r) => r.name },
    { key: "value", label: "level", num: true, cell: (r) => r.value },
  ],
};

const ABILITY = {
  cols: "minmax(3rem, 1fr) 2.4rem 2.4rem",
  fields: [
    { key: "name", label: "abilities", strong: true, cell: (r) => r.name },
    { key: "score", label: "score", num: true, cell: (r) => r.score },
    { key: "mod", label: "mod", num: true, cell: (r) => sign(r.mod) },
  ],
};

const SKILLS = {
  cols: "minmax(8rem, 1fr) 4rem 4rem",
  fields: [
    { key: "name", label: "skills", strong: true, cell: (r) => r.name },
    { key: "ability", label: "from", dim: true, cell: (r) => r.ability },
    { key: "bonus", label: "bonus", num: true, cell: (r) => sign(r.bonus) },
  ],
};

export default function Sheet({ vitals, skills }) {
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
    <div className="sheet">
      <div className="pair">
        <Table {...CONDITION} rows={condition} />
        <Table {...ABILITY} rows={scores} />
      </div>

      <Table {...SKILLS} rows={trained} rowClass={(r) => (r.trained ? "trained" : "untrained")} />
    </div>
  );
}
