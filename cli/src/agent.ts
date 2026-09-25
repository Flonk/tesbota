/**
 * Asking an agent something, and getting json back out of whatever it said.
 *
 * Every layer but the narrator comes through here. A call is one exchange: a
 * system prompt, a message, and the tools that layer is trusted with.
 */

import { query, type HookCallback, type Options } from "@anthropic-ai/claude-agent-sdk";
import { ROOT } from "./config.ts";
import type { Gate } from "./gate.ts";
import { fill } from "./prompts.ts";
import { Written } from "./schema.ts";

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

export function extractJson<T = unknown>(text: string | null | undefined): T {
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
  permission?: Gate | null;
  attempts?: number;
};

async function once(
  prompt: string, { system, tools, session, model, permission }: Required<Omit<Asked, "attempts">>
): Promise<[string, string | null]> {
  const chunks: string[] = [];
  let sessionId: string | null = session ?? null;

  // A bare name in `allowedTools` auto-approves the whole tool and the gate is
  // never consulted — which silently handed every agent an unrestricted shell.
  // When there is a gate, the tool is left out of the allowlist so every call
  // falls through to it.
  const options: Options = {
    systemPrompt: system,
    permissionMode: "acceptEdits",
    resume: session ?? undefined,
    cwd: ROOT,
    model: model ?? undefined,
  };
  options.tools = [...tools];
  if (permission) {
    options.canUseTool = permission;
    // Read-only commands are approved before canUseTool is ever asked, so the gate
    // also stands in front of every call as a hook, where nothing gets round it.
    const gate: HookCallback = async (input) => {
      if (input.hook_event_name !== "PreToolUse") return { continue: true };
      const verdict = await permission(input.tool_name, Written.safeParse(input.tool_input).data ?? {});
      if (verdict.behavior === "allow") return { continue: true };
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: verdict.message || "Nothing happens.",
        },
      };
    };
    options.hooks = { PreToolUse: [{ hooks: [gate] }] };
  } else options.allowedTools = [...tools];

  for await (const message of query({ prompt, options })) {
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
      return await once(said, { system: told, tools, session, model, permission });
    } catch (err) {
      last = err;
      if (attempt + 1 < attempts) await rest(2000);
    }
  }
  throw new AgentError(`agent call failed after ${attempts} attempts: ${last}`);
}
