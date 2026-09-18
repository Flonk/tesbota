import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = path.resolve(process.cwd(), "..");

export const dynamic = "force-dynamic";

/** The machine draws itself. There is no diagram here — only whatever the table says. */
export async function GET() {
  try {
    const { stdout } = await run(
      process.execPath,
      [path.join(ROOT, "cli/src/index.ts"), "machine", "--json"],
      { cwd: ROOT, timeout: 15000, maxBuffer: 1024 * 1024 * 4 }
    );
    return Response.json(JSON.parse(stdout.trim().split("\n").pop()));
  } catch (err) {
    return Response.json({ states: [], edges: [], error: String(err?.message || err) }, { status: 500 });
  }
}
