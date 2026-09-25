import { explorerGate, MAP, sqliteGate, type Gate } from "./gate.ts";

const MODEL = "claude-sonnet-5";
const DEEP = "claude-opus-5-5";

export type Agent = { prompt: string; label: string; model: string; gate: Gate | null };

const gm: Agent = {
  prompt: "gm", label: "game master", model: MODEL,
  gate: sqliteGate({ also: ["tesbota kill", "tesbota traits", ...MAP] }),
};

export const AGENTS = {
  explorer: { prompt: "explorer", label: "explorer", model: MODEL, gate: explorerGate },
  gm,
  answer: { ...gm, gate: sqliteGate({ also: ["tesbota traits", ...MAP] }) },
  propose: { prompt: "propose", label: "propose", model: MODEL, gate: sqliteGate({ also: MAP }) },
  lore1: { prompt: "lore1", label: "lore 1", model: MODEL, gate: null },
  lore2: { prompt: "lore2", label: "lore 2", model: MODEL, gate: sqliteGate({ also: MAP }) },
  queries: { prompt: "queries", label: "queries", model: MODEL, gate: sqliteGate({ also: MAP }) },
  lore3: { prompt: "lore3", label: "lore 3", model: MODEL, gate: sqliteGate({ readonly: false, also: MAP }) },
  lore4: { prompt: "lore4", label: "lore 4", model: DEEP, gate: sqliteGate({ readonly: false, also: MAP }) },
  questmaster: { prompt: "questmaster", label: "questmaster", model: DEEP, gate: sqliteGate({ also: MAP }) },
} satisfies Record<string, Agent>;

export type AgentId = keyof typeof AGENTS;
