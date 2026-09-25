import type { DatabaseSync } from "node:sqlite";
import { fields, list, named, once } from "./shared.ts";

export default function ways(con: DatabaseSync, id: string, value: unknown) {
  const rows = once(
    list(value, "doors").map((row, n) => {
      const got = fields(row, `door ${n + 1}`, ["dst"]);
      const dst = named(con, got.dst, `door ${n + 1}`, "places");
      if (!dst) throw new Error(`door ${n + 1} has to lead somewhere`);
      if (dst === id) throw new Error(`door ${n + 1} leads back into ${id}`);
      return dst;
    }),
    (dst) => dst,
    (dst) => `two doors lead into ${dst}`
  );
  con.prepare("DELETE FROM way WHERE src = ?").run(id);
  const put = con.prepare("INSERT INTO way (src, dst) VALUES (?, ?)");
  for (const dst of rows) put.run(id, dst);
}
