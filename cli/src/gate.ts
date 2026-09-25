/**
 * What an agent is allowed to run. The explorer has three commands of its own.
 * Every layer above it reads the world with one command and no shell around it:
 * sqlite3 on canon.db in safe mode, which refuses anything that reaches past the
 * file, and the few tesbota commands that layer is handed.
 */

import path from "node:path";
import type { PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { CANON_DB, ROOT } from "./config.ts";

export type Gate = (toolName: string, input: Record<string, unknown>) => Promise<PermissionResult>;

export const MAP = ["tesbota around", "tesbota route"];

const SHELL = ";|&$`<>(){}[]*?~#\n";
const BLANK = " \t";
const EXPANDS = "$`";
const ESCAPED = /["\\$`]/;
const FLAGS = ["-safe", "-readonly"];

/**
 * The words bash would hand the program, or null when bash would do anything more
 * with the line: run a second command, redirect, glob, expand something inside
 * double quotes, or be left inside an open quote.
 */
export function words(raw: string): string[] | null {
  const out: string[] = [];
  let word = "";
  let begun = false;
  let quote: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      else word += ch;
    } else if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === "\\" && ESCAPED.test(raw[i + 1] ?? "")) word += raw[++i];
      else if (EXPANDS.includes(ch)) return null;
      else word += ch;
    } else if (BLANK.includes(ch)) {
      if (begun) out.push(word);
      word = "";
      begun = false;
    } else if (SHELL.includes(ch)) {
      return null;
    } else {
      begun = true;
      if (ch === "'" || ch === '"') quote = ch;
      else if (ch !== "\\") word += ch;
      else if (i + 1 < raw.length && raw[i + 1] !== "\n") word += raw[++i];
      else return null;
    }
  }
  if (quote) return null;
  if (begun) out.push(word);
  return out;
}

export function spoken(raw: string): string[] {
  return raw.split(/\s+/).filter(Boolean);
}

const allow = (): PermissionResult => ({ behavior: "allow" });
const deny = (message: string): PermissionResult => ({ behavior: "deny", message });

export function sqliteGate(
  { readonly = true, also = [] }: { readonly?: boolean; also?: string[] } = {}
): Gate {
  const how = readonly
    ? 'sqlite3 -safe -readonly canon.db "SELECT ..."'
    : 'sqlite3 -safe canon.db "..."';
  return async (toolName, toolInput) => {
    if (toolName !== "Bash") return deny(`The world is only reachable with ${how}`);

    const said = words(String(toolInput.command ?? ""));
    if (!said) {
      return deny(
        `One command at a time, with no shell around it: ${how}. ` +
          "Inside double quotes, write a dollar sign as \\$."
      );
    }

    for (const command of also) {
      if (command.split(" ").every((w, i) => said[i] === w)) return allow();
    }

    const flags = said.slice(1).filter((w) => w.startsWith("-"));
    const [db] = said.slice(1).filter((w) => !w.startsWith("-"));
    if (
      said[0] !== "sqlite3" || !flags.includes("-safe") || flags.some((f) => !FLAGS.includes(f)) ||
      !db || path.resolve(ROOT, db) !== CANON_DB
    ) {
      return deny(`The only command you have is ${how}`);
    }
    if (readonly && !flags.includes("-readonly")) {
      return deny(`You read the world, you never write to it: ${how}`);
    }
    return allow();
  };
}

const EXPLORER_COMMANDS = ["tesbota stats", "tesbota inventory", "tesbota quests"];

const listed = (items: string[], last: string) =>
  `${items.slice(0, -1).join(", ")} ${last} ${items.at(-1)}`;

export const explorerGate: Gate = async (toolName, toolInput) => {
  if (toolName !== "Bash") {
    return deny(`You have no such power. You may run ${listed(EXPLORER_COMMANDS, "or")}.`);
  }
  const raw = String(toolInput.command ?? "");
  const parts = raw.split(/&&|;|\n/).map((p) => spoken(p).join(" "))
    .filter((p) => p && !/^echo\b/.test(p));
  const shell = [..."|&$`><"].some((ch) => raw.replace(/&&/g, "").includes(ch));
  if (!shell && parts.length && parts.every((p) => EXPLORER_COMMANDS.includes(p))) return allow();
  return deny(
    `Nothing happens. The only things you can do are ` +
      `${listed(EXPLORER_COMMANDS.map((c) => `\`${c}\``), "and")}, one at a time.`
  );
};
