import fs from "node:fs/promises";
import path from "node:path";

import { ROOT } from "../../../lib/store";

export const dynamic = "force-dynamic";

const PROMPTS = path.join(ROOT, "prompts");

export async function POST(request) {
  const { id, text } = await request.json();
  if (!/^[a-z0-9]+$/.test(String(id || ""))) {
    return Response.json({ error: "no such prompt" }, { status: 400 });
  }
  const file = path.join(PROMPTS, `${id}.md`);
  try {
    await fs.access(file);
  } catch {
    return Response.json({ error: "no such prompt" }, { status: 404 });
  }
  await fs.writeFile(file, String(text ?? ""), "utf8");
  return Response.json({ ok: true, id, chars: String(text ?? "").length });
}
