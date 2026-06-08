/**
 * Layer 3 — Run-phase state machine (Track 2 / Phase 2.1).
 *
 * Consolidates the 6 legacy `isComposerLoading` signals (sending,
 * waitingForResponse, hasActiveSend, activeIsRealtimeStreaming,
 * derivedIsStreaming, hasPendingGeneration) into a single explicit
 * per-session run phase. The legacy signals remain for backwards
 * compatibility; `selectIsComposerBusy` is the new parallel selector
 * that maps `runPhase` to the same boolean.
 *
 * ## Authority model
 *
 * `runPhase` transitions INTO `streaming` ONLY via:
 *   - SSE event handlers (`processEvent`)
 *   - `setSessionWaiting` (liveness snapshot — Track 1.2 authority)
 *   - `setActiveSend` (ref-based optimistic send)
 *
 * `runPhase` transitions OUT of `streaming` via:
 *   - `clearSessionWaiting`
 *   - `clearStreamingSession`
 *   - SSE completion / error events
 *   - `streamFinish()` (terminal reset)
 *
 * `runPhase` can be set to `interrupted` from the history predicate
 * (clear-only, Phase 1.2) — but NEVER to `streaming` from history.
 * This honors the fence at `isChatRuntimeBusy:159-165`.
 *
 * ## Why a state machine (not just a busy boolean)
 *
 * The legacy `isComposerLoading` is a black-box boolean derived from
 * 6 different signals. Callers cannot distinguish "sending" from
 * "streaming" from "waiting" from "interrupted". A state machine
 * makes the lifecycle explicit and enforces the authority model
 * structurally: a reducer cannot accept history as a busy-setter
 * because the state machine has no `streaming` transition that
 * takes history.
 */

export type RunPhase =
  | 'idle'
  | 'sending'
  | 'streaming'
  | 'complete'
  | 'error'
  | 'interrupted'

export type RunPhaseTrigger =
  | 'sse-event'
  | 'sse-complete'
  | 'sse-error'
  | 'liveness-snapshot'
  | 'liveness-clear'
  | 'active-send-set'
  | 'active-send-clear'
  | 'stream-finish'
  | 'predicate-clear'

/** Trigger source for a phase transition (observability + fence audit). */
export type RunPhaseTransition = {
  from: RunPhase
  to: RunPhase
  trigger: RunPhaseTrigger
  sessionKey: string
  at: number
}

/**
 * Reducer for run-phase transitions. Pure function — no side effects.
 *
 * Returns the next phase, or `null` if the transition is rejected.
 * The reject path exists so callers (the Zustand actions) can log
 * or alert on attempted fence violations.
 */
export function reduceRunPhase(
  current: RunPhase,
  next: RunPhase,
  trigger: RunPhaseTrigger,
): RunPhase | null {
  if (current === next) return current

  // Fence guard: history-derived triggers (predicate-clear) can only
  // move to non-busy terminal states. They can NEVER set streaming/sending.
  if (trigger === 'predicate-clear') {
    if (next === 'streaming' || next === 'sending') {
      return null
    }
    // Predicate can only clear (idle) or surface interrupted (non-busy terminal).
    if (next !== 'idle' && next !== 'interrupted' && next !== 'complete') {
      return null
    }
  }

  // sse-event can drive sending→streaming and streaming→streaming.
  if (trigger === 'sse-event') {
    if (next === 'idle' || next === 'interrupted') return null
  }

  // sse-complete / sse-error close out the run.
  if (trigger === 'sse-complete') {
    if (next !== 'complete' && next !== 'streaming' && next !== 'idle') return null
  }
  if (trigger === 'sse-error') {
    if (next !== 'error' && next !== 'streaming' && next !== 'idle') return null
  }

  // liveness-snapshot is the authority for "run is live". Maps to streaming.
  if (trigger === 'liveness-snapshot') {
    if (next !== 'streaming' && next !== 'sending') return null
  }

  // liveness-clear: snapshot absent → idle or interrupted (predicate decides).
  if (trigger === 'liveness-clear') {
    if (next !== 'idle' && next !== 'interrupted') return null
  }

  // active-send-set: optimistic send in flight.
  if (trigger === 'active-send-set') {
    if (next !== 'sending') return null
  }
  if (trigger === 'active-send-clear') {
    if (next !== 'streaming' && next !== 'idle' && next !== 'complete' && next !== 'error') return null
  }

  // stream-finish: terminal reset, only from busy states.
  if (trigger === 'stream-finish') {
    if (next !== 'idle' && next !== 'complete' && next !== 'error' && next !== 'interrupted') {
      return null
    }
  }

  return next
}

/** True if the phase represents "composer should be disabled". */
export function isRunPhaseBusy(phase: RunPhase): boolean {
  return phase === 'sending' || phase === 'streaming'
}

/** True if the phase is a terminal state (no further transitions expected). */
export function isRunPhaseTerminal(phase: RunPhase): boolean {
  return (
    phase === 'complete' ||
    phase === 'error' ||
    phase === 'interrupted' ||
    phase === 'idle'
  )
}
