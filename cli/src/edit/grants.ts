import type { DatabaseSync } from "node:sqlite";
import { list, named, once, upsert } from "./shared.ts";

const KIND = { aspect: "aspects", ability: "abilities" } as const;

const joined = (mine: keyof typeof KIND, what: string) => (con: DatabaseSync, id: string, value: unknown) => {
  const other = mine === "aspect" ? "ability" : "aspect";
  const them = once(
    list(value, what).map((v) => {
      const it = named(con, v, what, KIND[other]);
      if (!it) throw new Error(`${what}: every row names an ${other}`);
      return it;
    }),
    (it) => it,
    (it) => `${what}: ${it} is named twice`
  );
  for (const ability of mine === "ability" ? [id] : them) upsert(con, "ability", ability, {});
  con.prepare(`DELETE FROM grants WHERE ${mine} = ?`).run(id);
  const put = con.prepare(`INSERT INTO grants (${mine}, ${other}) VALUES (?, ?)`);
  for (const it of them) put.run(id, it);
};

export const grants = joined("aspect", "grants");
export const granted = joined("ability", "granted by");
