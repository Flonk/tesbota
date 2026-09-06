"use client";

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

export default function Sheet({ vitals, skills, inventory = [], notebook = [] }) {
  const abilities = skills?.abilities || {};
  const proficient = new Set(skills?.proficient || []);
  const bonus = Number(skills?.proficiency || 0);

  const worn = inventory.filter((i) => i.worn);
  const carried = inventory.filter((i) => !i.worn);

  return (
    <div className="cols">
      <div>
        <h3>condition</h3>
        <div className="rows">
          <span>health</span><span>{vitals?.health ?? 100} / 100</span>
          <span>fatigue</span><span>{vitals?.fatigue ?? 0} / 100</span>
          <span>hunger</span><span>{vitals?.hunger ?? 0} / 100</span>
        </div>

        <h3>abilities</h3>
        <div className="rows">
          {ABILITIES.map((a) => (
            <span key={a} className="ability">
              {a} <b>{abilities[a] ?? 10}</b> <i>{sign(mod(abilities[a]))}</i>
            </span>
          ))}
        </div>

        <h3>carrying</h3>
        {inventory.length === 0 && <p className="empty">nothing</p>}
        {worn.length > 0 && <div className="invgroup">worn</div>}
        {worn.map((i, n) => (
          <div className="item" key={`w${n}`}>
            {i.name}{i.qty > 1 ? ` ×${i.qty}` : ""}
            {i.note && <span className="note">{i.note}</span>}
          </div>
        ))}
        {carried.length > 0 && <div className="invgroup">carried</div>}
        {carried.map((i, n) => (
          <div className="item" key={`c${n}`}>
            {i.name}{i.qty > 1 ? ` ×${i.qty}` : ""}
            {i.note && <span className="note">{i.note}</span>}
          </div>
        ))}
      </div>

      <div>
        <h3>notebook</h3>
        {notebook.length === 0 && <p className="empty">nothing written</p>}
        {notebook.map((n, i) => (
          <div className="item" key={i}>{n}</div>
        ))}

        <h3>skills</h3>
        {Object.keys(SKILL_ABILITY).sort().map((name) => {
          const trained = proficient.has(name);
          const total = mod(abilities[SKILL_ABILITY[name]]) + (trained ? bonus : 0);
          return (
            <div className={`skill ${trained ? "trained" : ""}`} key={name}>
              <span className="sname">{name}</span>
              <span className="sab">{SKILL_ABILITY[name]}</span>
              <span className="sval">{sign(total)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
