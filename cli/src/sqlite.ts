/**
 * Where `sqlite3` is.
 *
 * Every layer above the explorer reads the world with that one binary, and it
 * comes from this project's nix-shell rather than from the machine. Anything that
 * starts the cli without having entered that shell — the web server, for one —
 * hands its agents a PATH the binary is not on, and from the other side that
 * reads as a lore master that simply cannot see the world and says so at length.
 *
 * So it is found rather than assumed, and put back on PATH for whoever we spawn.
 */

import fs from "node:fs";
import path from "node:path";

const NAME = "sqlite3";
const STORE = "/nix/store";

const runnable = (at: string) => {
  try {
    fs.accessSync(at, fs.constants.X_OK);
    return fs.statSync(at).isFile();
  } catch {
    return false;
  }
};

function onPath(): string | null {
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (dir && runnable(path.join(dir, NAME))) return path.join(dir, NAME);
  }
  return null;
}

/**
 * The newest one the store has. `shell.nix` asks for sqlite, so a machine that has
 * ever entered the shell already has it — it is only the PATH that was lost.
 */
function inStore(): string | null {
  let names: string[];
  try {
    names = fs.readdirSync(STORE).filter((n) => /-sqlite-[\d.]+-bin$/.test(n));
  } catch {
    return null;
  }
  const version = (n: string) =>
    (n.match(/-sqlite-([\d.]+)-bin$/)?.[1] ?? "0").split(".").map(Number);
  names.sort((a, b) => {
    const x = version(a);
    const y = version(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
    }
    return 0;
  });
  for (const name of names) {
    const at = path.join(STORE, name, "bin", NAME);
    if (runnable(at)) return at;
  }
  return null;
}

let found: string | null | undefined;

export function sqlite3(): string | null {
  if (found === undefined) found = onPath() ?? inStore();
  return found;
}

/** Put it back on PATH, so everything we spawn inherits a world it can read. */
export function reachable(): string | null {
  const at = sqlite3();
  if (!at) return null;
  const dir = path.dirname(at);
  const parts = (process.env.PATH || "").split(path.delimiter);
  if (!parts.includes(dir)) process.env.PATH = [dir, ...parts].join(path.delimiter);
  return at;
}
