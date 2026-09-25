import type { EdgeOn, LoopState } from "../machine.ts";
import type { Rng } from "../rng.ts";
import type { CampaignT, DraftT, FightT, PhaseT, TurnT } from "../schema.ts";

/** What a step is handed, and the only thing it is handed. */
export type World = { campaign: CampaignT; turn: TurnT };

/** What a step gives back: the name of one edge out of the state it was in. */
export type Step<S extends LoopState> = (world: World, rng?: Rng) => Promise<EdgeOn<S>>;

export function drafted(turn: TurnT): DraftT {
  if (!turn.draft) throw new Error(`${turn.turn_id} has no draft`);
  return turn.draft;
}

export const fighting = (turn: TurnT) =>
  turn.phases.find((x) => x.kind === "fight" && x.status !== "checked")?.fight ?? null;

export function fightOf(turn: TurnT): FightT {
  const running = fighting(turn);
  if (!running) throw new Error(`${turn.turn_id} has no fight`);
  return running;
}

export const onRoad = (turn: TurnT) => !turn.action && !!turn.journey;

export function phase(
  turn: TurnT, who: PhaseT["who"], kind: PhaseT["kind"], text: string, extra: Partial<PhaseT> = {}
): PhaseT {
  const entry: PhaseT = {
    n: turn.phases.length + 1,
    who,
    kind,
    text,
    status: who === "explorer" ? "said" : "pending",
    claims: [],
    ...extra,
  };
  turn.phases.push(entry);
  return entry;
}

/**
 * Append what the game master said. A pending phase is rewritten in place — that
 * only happens when the lore master has sent it back.
 */
export function gmPhase(turn: TurnT, kind: PhaseT["kind"], text: string, extra: Partial<PhaseT> = {}): PhaseT {
  const last = openPhase(turn);
  if (last) {
    last.kind = kind;
    last.text = text;
    delete last.fight;
    Object.assign(last, extra);
    return last;
  }
  return phase(turn, "gm", kind, text, extra);
}

export function openPhase(turn: TurnT): PhaseT | null {
  const last = turn.phases[turn.phases.length - 1];
  return last && last.who === "gm" && last.status === "pending" ? last : null;
}
