/**
 * Asking an agent something, and getting json back out of whatever it said.
 *
 * Every layer but the narrator comes through here. A call is one exchange: a
 * system prompt, a message, and the tools that layer is trusted with.
 */

import { query, type CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { ROOT } from "./config.ts";
import { fill } from "./prompts.ts";

export class AgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentError";
  }
}

const FENCE = /```(?:json)?\s*([\s\S]*?)```/;
const CLOSERS = new Set([",", ":", "}", "]"]);

/** Escape the bare double quotes a game master leaves around spoken words. */
export function mend(raw: string): string {
  const out: string[] = [];
  let inside = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) {
      out.push(ch);
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out.push(ch);
      escaped = true;
      continue;
    }
    if (ch === '"') {
      if (!inside) {
        inside = true;
        out.push(ch);
        continue;
      }
      const rest = raw.slice(i + 1).replace(/^\s+/, "");
      if (!rest || CLOSERS.has(rest[0])) {
        inside = false;
        out.push(ch);
      } else {
        out.push('\\"');
      }
      continue;
    }
    out.push(ch);
  }
  return out.join("");
}

export function extractJson<T = any>(text: string | null | undefined): T {
  const said = String(text ?? "");
  const match = FENCE.exec(said);
  const raw = match ? match[1] : said;
  try {
    return JSON.parse(raw) as T;
  } catch (first) {
    try {
      return JSON.parse(mend(raw)) as T;
    } catch {
      throw new AgentError(
        `agent did not return parseable json: ${(first as Error).message}\n\n${said}`
      );
    }
  }
}

export type Asked = {
  system: string;
  tools?: readonly string[];
  session?: string | null;
  model?: string | null;
  permission?: CanUseTool | null;
  attempts?: number;
};

async function once(
  prompt: string, system: string, tools: readonly string[], session: string | null | undefined,
  model: string | null | undefined, permission: CanUseTool | null | undefined
): Promise<[string, string | null]> {
  const chunks: string[] = [];
  let sessionId: string | null = session ?? null;

  for await (const message of query({
    prompt,
    options: {
      systemPrompt: system,
      allowedTools: [...tools],
      permissionMode: "acceptEdits",
      resume: session ?? undefined,
      cwd: ROOT,
      model: model ?? undefined,
      canUseTool: permission ?? undefined,
    },
  })) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text") chunks.push(block.text);
      }
    } else if (message.type === "result") {
      sessionId = message.session_id;
    }
  }
  return [chunks.join("\n").trim(), sessionId];
}

const rest = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function ask(prompt: string, opts: Asked): Promise<[string, string | null]> {
  const { system, tools = [], session = null, model = null, permission = null, attempts = 2 } = opts;
  const said = fill(prompt);
  const told = fill(system);
  let last: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await once(said, told, tools, session, model, permission);
    } catch (err) {
      last = err;
      if (attempt + 1 < attempts) await rest(2000);
    }
  }
  throw new AgentError(`agent call failed after ${attempts} attempts: ${last}`);
}
