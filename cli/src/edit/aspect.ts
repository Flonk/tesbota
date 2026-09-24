import type { Ctx } from "./index.ts";
import { Ability } from "../schema.ts";
import { fields, oneOf } from "./shared.ts";

export default function aspect(con: any, id: string, value: unknown, ctx: Ctx) {
  if (ctx.kind !== "aspects") throw new Error(`aspect: ${id} is one of the ${ctx.kind}, not the aspects`);
  const got = fields(value, "aspect", ["applies", "ability"]);
  con.prepare("INSERT INTO aspect (id) VALUES (?) ON CONFLICT(id) DO NOTHING").run(id);
  if ("applies" in got) {
    const applies = oneOf(got.applies, "applies", ["always", "within"]);
    con.prepare("UPDATE aspect SET applies = ? WHERE id = ?").run(applies, id);
  }
  if ("ability" in got) {
    let power = got.ability;
    if (typeof power === "string") {
      if (!power.trim()) power = null;
      else {
        try {
          power = JSON.parse(power);
        } catch {
          throw new Error("the aspect's ability is written in json");
        }
      }
    }
    if (power !== null && power !== undefined) {
      if (typeof power !== "object" || Array.isArray(power)) throw new Error("the aspect's ability is an object of fields");
      const read = Ability.safeParse(power);
      if (!read.success) {
        const first = read.error.issues[0];
        throw new Error(`the aspect's ability: ${first.path.join(".") || "it"} ${first.message}`);
      }
    }
    con.prepare("UPDATE aspect SET ability = ? WHERE id = ?").run(power ? JSON.stringify(power) : null, id);
  }
}
