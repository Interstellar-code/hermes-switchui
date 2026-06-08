import { useEffect } from 'react'

import { useChatStore } from '../../../stores/chat-store'
import {
  hasUnansweredLatestUserTurn,
  latestTurnIsToolOnly,
} from '../chat-screen-utils'
import type { ChatMessage } from '../types'

export type ActiveRunStatus =
  | 'accepted'
  | 'active'
  | 'handoff'
  | 'stalled'
  | 'complete'
  | 'error'

export type ActiveRunSnapshot = {
  runId: string
  status: ActiveRunStatus
  sessionKey: string
  startedAt?: number
  createdAt?: number
  updatedAt?: number
  lastEventAt?: number
}

type ActiveRunResponse = {
  ok: boolean
  run: ActiveRunSnapshot | null
}

const RECOVERABLE_HANDOFF_WINDOW_MS = 30_000
const ACTIVE_RUN_CHECK_RETRY_MS = 1_500
const ACTIVE_RUN_CHECK_MAX_ATTEMPTS = 3

export function isRecoverableActiveRun(
  run: ActiveRunSnapshot | null,
  now = Date.now(),
): run is ActiveRunSnapshot {
  if (!run) return false
  if (run.status === 'accepted' || run.status === 'active') return true
  if (run.status !== 'handoff') return false

  const lastActivityAt =
    run.lastEventAt ?? run.updatedAt ?? run.startedAt ?? run.createdAt
  return (
    typeof lastActivityAt === 'number' &&
    now - lastActivityAt <= RECOVERABLE_HANDOFF_WINDOW_MS
  )
}

const RECOVERY_RECONCILE_FLAG_KEY = 'switchui:recovery-reconcile-v1'

function isRecoveryReconcileEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false
  const stored = localStorage.getItem(RECOVERY_RECONCILE_FLAG_KEY)
  if (stored === '0' || stored === 'false') return false
  return true
}

/**
 * On mount, checks whether the server has an active run for this session.
 *
 * ## Authority model (Track 1.2)
 *
 * The liveness snapshot is the ONLY authority for "is a run live for this
 * UI process." The history predicate (`hasUnansweredLatestUserTurn`) is a
 * CLEAR-ONLY hint: it may force a transition to `interrupted` (non-busy
 * terminal) or `complete` (idle), but it can NEVER set or sustain
 * `streaming`/busy. The fence at `isChatRuntimeBusy:159-165` forbids
 * history from feeding busy logic — this hook honors it structurally.
 *
 * Decision matrix:
 *
 *  | snapshot        | predicate       | → state                              |
 *  |-----------------|-----------------|--------------------------------------|
 *  | recoverable     | (ignored)       | `streaming` (waiting)                |
 *  | absent          | unanswered +    | `interrupted` (affordance, not busy) |
 *  |                 | not tool-only + |                                      |
 *  |                 | history present |                                      |
 *  | absent          | answered OR     | `complete` (clear waiting +          |
 *  |                 | tool-only OR    | interrupted)                         |
 *  |                 | empty history   |                                      |
 *
 * F1 (tool-only false positive) is guarded by `latestTurnIsToolOnly`. A
 * turn that completed with only tool output never reads as `interrupted`
 * — the user already saw the tool stream, and the affordance would be
 * confusing.
 *
 * Gated by `localStorage.switchui:recovery-reconcile-v1` (default ON).
 * Set to `0` to revert to legacy behaviour (snapshot OR clear) without a
 * deploy. This is the Architect kill-switch.
 */
export function useActiveRunCheck({
  sessionKey,
  enabled,
  messages,
}: {
  sessionKey: string
  enabled: boolean
  /** Cached message history for the session — used by the predicate. */
  messages?: Array<ChatMessage>
}): void {
  useEffect(() => {
    if (!enabled || !sessionKey || sessionKey === 'new') return

    const controller = new AbortController()
    let retryTimer: number | null = null
    let attempts = 0
    const reconcileEnabled = isRecoveryReconcileEnabled()

    async function check() {
      attempts += 1
      try {
        const response = await fetch(
          `/api/sessions/${encodeURIComponent(sessionKey)}/active-run`,
          { signal: controller.signal },
        )
        if (!response.ok)
          throw new Error(`Active run check failed: ${response.status}`)

        const data = (await response.json()) as ActiveRunResponse
        if (!data.ok) throw new Error('Active run check returned an error')

        const store = useChatStore.getState()

        if (isRecoverableActiveRun(data.run)) {
          // AUTHORITY: liveness says a run is live. Mark waiting, kill any
          // stale interrupted flag, and stop.
          if (store.isSessionInterrupted(sessionKey)) {
            store.clearSessionInterrupted(sessionKey)
          }
          store.setSessionWaiting(sessionKey, data.run.runId)
          return
        }

        // No recoverable snapshot. Liveness authority says "nothing live."
        // Clear any prior waiting/interrupted state, then (if reconcile is
        // on) consult the predicate as a clear-only hint.
        if (store.isSessionWaiting(sessionKey)) {
          store.clearSessionWaiting(sessionKey)
        }

        if (!reconcileEnabled) {
          // Legacy path: just clear. No interrupted affordance.
          if (store.isSessionInterrupted(sessionKey)) {
            store.clearSessionInterrupted(sessionKey)
          }
          return
        }

        const history = messages ?? []
        const hasUnanswered = hasUnansweredLatestUserTurn(history)
        const toolOnly = latestTurnIsToolOnly(history)
        const hasHistory = history.length > 0

        if (hasUnanswered && !toolOnly && hasHistory) {
          // Clear-only path: predicate forces a non-busy terminal.
          if (!store.isSessionInterrupted(sessionKey)) {
            store.setSessionInterrupted(sessionKey)
          }
        } else {
          // Answered turn, tool-only completion, or empty history (portable).
          // Clear interrupted; idle/complete.
          if (store.isSessionInterrupted(sessionKey)) {
            store.clearSessionInterrupted(sessionKey)
          }
        }
      } catch {
        if (
          !controller.signal.aborted &&
          attempts < ACTIVE_RUN_CHECK_MAX_ATTEMPTS
        ) {
          retryTimer = window.setTimeout(check, ACTIVE_RUN_CHECK_RETRY_MS)
        }
      }
    }

    void check()

    return () => {
      controller.abort()
      if (retryTimer) window.clearTimeout(retryTimer)
    }
  }, [sessionKey, enabled, messages])
}
