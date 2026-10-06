/**
 * graph-history.ts — undo/redo history over the draft YAML string (F4).
 * Pure reducer: the draft text is the single source of truth, so history
 * snapshots are cheap, lossless and trivially serialisable.
 */
export const HISTORY_CAP = 100

export interface GraphHistoryState {
  past: Array<string>
  present: string
  future: Array<string>
  /** YAML of the last save / load — the dirty baseline. */
  saved: string
  /** past.length captured when the baseline last moved. */
  savedDepth: number
}

export type GraphHistoryAction =
  | { type: 'edit'; yaml: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'markSaved' }
  /** DISCARD / external reload: reset history to the given YAML. */
  | { type: 'reset'; yaml: string }

export function initHistory(yaml: string): GraphHistoryState {
  return {
    past: [],
    present: yaml,
    future: [],
    saved: yaml,
    savedDepth: 0,
  }
}

export function graphReducer(
  state: GraphHistoryState,
  action: GraphHistoryAction,
): GraphHistoryState {
  switch (action.type) {
    case 'edit': {
      if (action.yaml === state.present) return state
      const past = [...state.past, state.present]
      if (past.length > HISTORY_CAP) past.shift()
      return { ...state, past, present: action.yaml, future: [] }
    }
    case 'undo': {
      if (state.past.length === 0) return state
      const prev = state.past[state.past.length - 1]
      return {
        ...state,
        past: state.past.slice(0, -1),
        present: prev,
        future: [state.present, ...state.future],
      }
    }
    case 'redo': {
      if (state.future.length === 0) return state
      const [next, ...rest] = state.future
      return {
        ...state,
        past: [...state.past, state.present],
        present: next,
        future: rest,
      }
    }
    case 'markSaved':
      return { ...state, saved: state.present, savedDepth: state.past.length }
    case 'reset':
      return initHistory(action.yaml)
  }
}

/** "N UNSAVED CHANGES" — edit distance from the saved baseline, min 1 when dirty. */
export function unsavedCount(state: GraphHistoryState): number {
  if (state.present === state.saved) return 0
  return Math.max(1, state.past.length - state.savedDepth)
}
