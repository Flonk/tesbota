/**
 * Asking an agent something, and getting json back out of whatever it said.
 *
 * Every layer but the narrator comes through here. A call is one exchange: a
 * system prompt, a message, and the tools that layer is trusted with.
 */

import { query, type HookCallback, type Options } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { ROOT } from "./config.ts";
import { AGENTS, type Agent, type AgentId } from "./agents.ts";
import { block, fill } from "./prompts.ts";
import { Written } from "./schema.ts";

export class AgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentError";
  }
}

const FENCE = /```(\w*)\s*([\s\S]*?)```/g;
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

function fenced(said: string): string {
  const fences = [...said.matchAll(FENCE)];
  const json = fences.filter(([, tag]) => tag.toLowerCase() === "json");
  return (json.at(-1) ?? fences.at(-1))?.[2] ?? said;
}

function parsed(said: string): unknown {
  const raw = fenced(said);
  try {
    return JSON.parse(raw);
  } catch (first) {
    try {
      return JSON.parse(mend(raw));
    } catch {
      throw new AgentError(
        `agent did not return parseable json: ${(first as Error).message}\n\n${said}`
      );
    }
  }
}

export function extractJson<S extends z.ZodType>(text: string | null | undefined, shape: S): z.output<S> {
  const said = String(text ?? "");
  const read = shape.safeParse(parsed(said));
  if (read.success) return read.data;
  throw new AgentError(`agent's json is not the shape asked for:\n${z.prettifyError(read.error)}\n\n${said}`);
}

async function once(
  prompt: string, system: string, { model, gate: permission }: Agent, session: string | null
): Promise<[string, string | null]> {
  const chunks: string[] = [];
  let sessionId: string | null = session;
  const tools = permission ? ["Bash"] : [];

  // A bare name in `allowedTools` auto-approves the whole tool and the gate is
  // never consulted — which silently handed every agent an unrestricted shell.
  // When there is a gate, the tool is left out of the allowlist so every call
  // falls through to it.
  const options: Options = {
    systemPrompt: system,
    permissionMode: "acceptEdits",
    resume: session ?? undefined,
    cwd: ROOT,
    model,
  };
  options.tools = tools;
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
  } else options.allowedTools = tools;

  for await (const message of query({ prompt, options })) {
    if (message.type === "assistant") {
      for (const part of message.message.content) {
        if (part.type === "text") chunks.push(part.text);
      }
    } else if (message.type === "result") {
      sessionId = message.session_id;
    }
  }
  return [chunks.join("\n").trim(), sessionId];
}

const rest = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ATTEMPTS = 2;

export async function ask(
  agent: AgentId, message: string, session?: string | null
): Promise<[string, string | null]> {
  const asked = AGENTS[agent];
  const said = fill(message);
  const told = fill(block(asked.prompt));
  let last: unknown = null;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      return await once(said, told, asked, session ?? null);
    } catch (err) {
      last = err;
      if (attempt + 1 < ATTEMPTS) await rest(2000);
    }
  }
  throw new AgentError(`agent call failed after ${ATTEMPTS} attempts: ${last}`);
}
