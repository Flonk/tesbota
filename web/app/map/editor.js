import { added, moved, opened, runsOf } from "../shaping";
import { isRun } from "../world";

export const UNWRITTEN = "\u0000new";

export const IDLE = {
  chosen: null,
  fresh: null,
  draft: null,
  // How far the whole shape has been carried, and whether what stood on it comes.
  carry: null,
  bringing: true,
  // How far the hand has got this drag, before it has let go.
  towed: null,
  past: [],
  future: [],
  picked: null,
};

export const sum = (a, b) => ({ lon: (a?.lon || 0) + (b?.lon || 0), lat: (a?.lat || 0) + (b?.lat || 0) });

function draftOf(place) {
  const read = runsOf(place.extent);
  const shut = !isRun(place.type);
  const width = shut ? null : place.width ?? null;
  return read
    ? { ...read, runs: read.shut ? read.runs.map(opened) : read.runs, width }
    : { shut, runs: [[]], groups: [0], width };
}

const blank = (type) => ({ shut: !isRun(type), runs: [[]], groups: [0], width: null });

export const onRun = (draft, i, change) => ({ ...draft, runs: draft.runs.map((r, n) => (n === i ? change(r) : r)) });

const kept = (state) => ({ draft: state.draft, carry: state.carry });
const remember = (state, before = kept(state)) => ({ past: [...state.past.slice(-199), before], future: [] });

export function edit(state, a) {
  switch (a.type) {
    case "take":
      return { ...IDLE, chosen: a.place.id, draft: draftOf(a.place) };
    case "found":
      return { ...IDLE, chosen: UNWRITTEN, fresh: { id: UNWRITTEN, ...a.fresh }, draft: blank(a.fresh.type) };
    case "release":
      return IDLE;
    case "blank":
      return { ...state, draft: blank(state.fresh.type), carry: null, picked: null, past: [], future: [] };
    case "commit":
      return { ...state, ...remember(state), draft: a.draft, picked: a.picked === undefined ? state.picked : a.picked };
    case "corner":
      return state.draft ? { ...state, draft: onRun(state.draft, a.run, (r) => moved(r, a.at, a.point)) } : state;
    case "grow": {
      const draft = onRun(state.draft, a.run, (r) => added(r, a.at, a.point));
      return { ...state, ...(a.keep ? remember(state) : {}), draft, picked: { run: a.run, at: a.at } };
    }
    case "shove":
      return state.draft ? { ...state, draft: { ...state.draft, runs: a.runs }, towed: a.by } : state;
    case "cornered":
      return { ...state, ...remember(state, a.before) };
    case "shoved":
      return a.by && (a.by.lon || a.by.lat)
        ? { ...state, ...remember(state, a.before), towed: null, carry: sum(state.carry, a.by) }
        : { ...state, towed: null };
    case "abandon":
      return { ...state, ...a.before, towed: null };
    case "undo": {
      if (!state.past.length) return state;
      return {
        ...state,
        ...state.past[state.past.length - 1],
        past: state.past.slice(0, -1),
        future: [kept(state), ...state.future],
        picked: null,
      };
    }
    case "redo": {
      if (!state.future.length) return state;
      return {
        ...state,
        ...state.future[0],
        past: [...state.past, kept(state)],
        future: state.future.slice(1),
        picked: null,
      };
    }
    case "pick":
      return { ...state, picked: a.at };
    case "bring":
      return { ...state, bringing: !state.bringing };
    case "written":
      return { ...state, chosen: a.id, fresh: { ...state.fresh, id: a.id }, picked: null };
    case "saved":
      return { ...state, carry: null, towed: null, past: [], future: [] };
    default:
      return state;
  }
}
