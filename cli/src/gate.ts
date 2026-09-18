/**
 * What an agent is allowed to run. Every layer above the explorer reads the world
 * with one command and no shell around it, so the gate is small on purpose: one
 * binary, one flag, and a short list of tables anybody may write to.
 */

import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";

const SHELL = ";|&$`><\n";

const WRITE_TARGET =
  /\b(?:insert(?:\s+or\s+\w+)?\s+into|update|delete\s+from|replace\s+into)\s+([a-z_][a-z_0-9]*)/gi;
const SCHEMA_VERB = /\b(?:drop|alter|create|attach|detach|vacuum|pragma)\b/i;

/** The command with everything inside quotes taken out, so a table named in prose does not count. */
export function bare(raw: string): string {
  const out: string[] = [];
  let quote: string | null = null;
  for (const ch of raw) {
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    out.push(ch);
  }
  return out.join("");
}

export function spoken(raw: string): string[] {
  let words = String(raw ?? "").trim().split(/\s+/).filter(Boolean);
  if (words[0] === "uv" && words[1] === "run") words = words.slice(2);
  return words;
}

const allow = (): PermissionResult => ({ behavior: "allow" });
const deny = (message: string): PermissionResult => ({ behavior: "deny", message });

export function sqliteGate(
  { readonly = true, tables = null, also = [] }:
  { readonly?: boolean; tables?: string[] | null; also?: string[] } = {}
): CanUseTool {
  return async (toolName, toolInput) => {
    const how = readonly
      ? 'sqlite3 -readonly canon.db "SELECT ..."'
      : 'sqlite3 canon.db "..."';
    if (toolName !== "Bash") return deny(`The world is only reachable with ${how}`);

    const raw = String((toolInput as any)?.command ?? "");
    const stripped = bare(raw);
    if ([...SHELL].some((ch) => stripped.includes(ch))) {
      return deny(`One command at a time, with no shell around it: ${how}`);
    }

    const said = spoken(raw);
    for (const command of also) {
      const want = command.split(/\s+/);
      if (want.every((w, i) => said[i] === w)) return allow();
    }

    const words = raw.trim().split(/\s+/).filter(Boolean);
    if (!words.length || words[0] !== "sqlite3") return deny(`The only command you have is ${how}`);
    if (readonly && !words.includes("-readonly")) {
      return deny(
        'You read the world, you never write to it: sqlite3 -readonly canon.db "SELECT ..."'
      );
    }
    if (tables !== null && !words.includes("-readonly")) {
      const allowed = tables.join(", ");
      if (SCHEMA_VERB.test(stripped)) {
        return deny(`You do not shape the world, you write in it. Only ${allowed}.`);
      }
      const touched = new Set(
        [...stripped.matchAll(WRITE_TARGET)].map((m) => m[1].toLowerCase())
      );
      const outside = [...touched].filter((t) => !tables.includes(t)).sort();
      if (outside.length) {
        return deny(
          `That is not yours to write: ${outside.join(", ")}. ` +
            `You write to ${allowed} and nothing else.`
        );
      }
    }
    return allow();
  };
}
