/**
 * The transitions, one function each.
 *
 * A step is handed the world, changes it, and returns the name of the edge it is
 * taking. It never says what state comes next — `machine.ts` owns that, and an
 * edge that is not declared there cannot be taken. This is the whole of the
 * difference from what came before, where thirty-eight scattered assignments
 * decided the shape of the machine between them and nothing could be read off.
 */

import type { LoopState } from "../machine.ts";
import { stepDeliver, stepNarrate } from "./deliver.ts";
import { stepExplorer } from "./explorer.ts";
import { stepFight, stepMuster, stepSwing } from "./fight.ts";
import { stepAnswer, stepBlows, stepGm, stepPropose } from "./gm.ts";
import { stepLore1, stepLore2 } from "./lore.ts";
import type { Step } from "./turn.ts";

/** The handler for each state. The edges they may return are in `machine.ts`. */
export const STEPS: { [S in LoopState]: Step<S> } = {
  explorer: stepExplorer,
  answer: stepAnswer,
  propose: stepPropose,
  gm: stepGm,
  muster: stepMuster,
  swing: stepSwing,
  fight: stepFight,
  blows: stepBlows,
  lore1: stepLore1,
  lore2: stepLore2,
  deliver: stepDeliver,
  narrate: stepNarrate,
};
