import { useCallback, useEffect, useRef, useState } from 'react'

import { updateHistoryMessageByClientIdEverywhere } from '../chat-queries'
import type { QueryClient } from '@tanstack/react-query'
import type { RunStatusResponse, RunStopResponse } from '@/lib/run-stop'
import {
  ACTIVE_RUN_TOKEN,
  isCancelledRunStatus,
  isTerminalRunStatus,
} from '@/lib/run-stop'
import { getSessionProfile, profileBody } from '@/lib/session-scope'

/**
 * useRunStop — the gateway half of the Stop button.
 *
 * ## What this hook is NOT allowed to do
 *
 * It must never gate the composer. `handleAbortStreaming` unlocks the UI
 * synchronously and stays authoritative for busy state; this hook is a
 * best-effort side effect layered on top. A stop request that hangs, 500s or
 * never resolves changes only what the user is *told*, never whether they can
 * type. (`isChatRuntimeBusy` warns that anything else lets a session self-lock
 * and queue every future message.)
 *
 * ## Why it polls
 *
 * Stop is cooperative. `POST /v1/runs/{id}/stop` returning 200 means a flag was
 * set and `agent.interrupt()` was called — nothing more. The gateway emits no
 * SSE event for it, and the `run.cancelled` frame that may eventually arrive on
 * the stream is best-effort and undelivered if the transport was swept. The
 * status poll is the only reliable terminal signal, so "Stopped" is claimed
 * only when `GET /v1/runs/{id}` reports `cancelled`.
 *
 * ## Why it touches the user message's status
 *
 * `handleAbortStreaming` marks the optimistic user message `stopping`, which
 * `isPendingUserMessage` counts as still pending — so `useActiveRunCheck` keeps
 * the "Run may have continued server-side — resend?" affordance armed. That is
 * the correct default while a stop is unconfirmed. This hook flips the message
 * to `sent` ONLY on a confirmed outcome (the run reported terminal), which
 * disarms the affordance because there is genuinely nothing to recover. A
 * failed or unconfirmed stop leaves it armed and says so.
 *
 * It deliberately never calls `setSessionInterrupted`: an explicit stop and
 * "we lost the run, resend?" are different messages and must stay different.
 */

export type RunStopPhase =
  /** Asked; the run is unwinding. No deadline exists. */
  | 'stopping'
  /** Still `stopping` past the linger threshold — an uninterruptible step. */
  | 'lingering'
  /** Confirmed `cancelled`. */
  | 'stopped'
  /** The run was already terminal when the stop arrived. */
  | 'already-finished'
  /** The run reached a non-cancelled terminal state before the stop landed. */
  | 'finished-first'
  /** The gateway will not stop this run, and it is still live. */
  | 'unstoppable'
  /** We do not know what happened. */
  | 'failed'

export type RunStopNotice = {
  phase: RunStopPhase
  message: string
  tone: 'info' | 'warning'
  /**
   * True only when the gateway positively confirmed the run is over. Drives
   * both the safety-net flip and whether the notice self-dismisses.
   */
  confirmed: boolean
  sessionKey: string
}

/**
 * Copy rules, in order of importance:
 *
 * 1. Never say "stopped" before the run reports `cancelled`.
 * 2. Never imply work already done was undone. A stop that lands after a file
 *    write does not unwrite the file, and a killed shell command does not
 *    un-delete what it deleted. "Anything it already did stays done."
 * 3. When we do not know, say we do not know — and name the consequence
 *    (it may still be running) rather than the HTTP status.
 */
export const RUN_STOP_COPY: Record<RunStopPhase, string> = {
  stopping:
    'Stopping… The agent has been asked to stop. Anything it already did stays done.',
  lingering:
    'Still stopping. The agent is inside a step that cannot be interrupted — it will stop once that step finishes. Anything it already did stays done.',
  stopped: 'Stopped. Anything the agent already did stays done.',
  'already-finished': 'Nothing to stop — the run had already finished.',
  'finished-first': 'The run finished before the stop reached it.',
  unstoppable:
    'This run cannot be stopped from here yet — it may still be running server-side.',
  failed:
    'Could not confirm the stop — the run may still be running server-side.',
}

const TONES: Record<RunStopPhase, 'info' | 'warning'> = {
  stopping: 'info',
  lingering: 'warning',
  stopped: 'info',
  'already-finished': 'info',
  'finished-first': 'info',
  unstoppable: 'warning',
  failed: 'warning',
}

const CONFIRMED: Record<RunStopPhase, boolean> = {
  stopping: false,
  lingering: false,
  stopped: true,
  'already-finished': true,
  'finished-first': true,
  unstoppable: false,
  failed: false,
}

/** How often to poll `GET /api/runs/:runId/status`. */
export const RUN_STOP_POLL_MS = 1_500
/**
 * How long `stopping` may last before we stop implying it is nearly over.
 * There is no gateway-side deadline; this threshold only changes the copy.
 */
export const RUN_STOP_LINGER_MS = 20_000
/** When to give up polling. The run may still be `stopping` — we just stop asking. */
export const RUN_STOP_POLL_TIMEOUT_MS = 5 * 60_000
/** How long a confirmed notice stays on screen before self-dismissing. */
export const RUN_STOP_NOTICE_TTL_MS = 6_000
/** Consecutive transport failures tolerated while polling. */
const RUN_STOP_POLL_MAX_ERRORS = 3

export type UseRunStopResult = {
  /**
   * Fire-and-forget. Returns synchronously, never throws, never resolves into
   * the caller — the composer must not wait on it.
   */
  requestStop: (params: {
    sessionKey: string
    clientId?: string | null
  }) => void
  stopNotice: RunStopNotice | null
  dismissStopNotice: () => void
}

export function useRunStop({
  queryClient,
}: {
  queryClient: QueryClient
}): UseRunStopResult {
  const [stopNotice, setStopNotice] = useState<RunStopNotice | null>(null)

  // Every stop request takes a generation. Anything a previous generation was
  // still awaiting (a slow POST, an in-flight poll) is ignored on arrival, so
  // a second Stop — or a new send — can never be narrated by a stale run.
  const generationRef = useRef(0)
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    const timers = timersRef.current
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
    }
  }, [])

  const schedule = useCallback((fn: () => void, delay: number) => {
    const timer = setTimeout(() => {
      timersRef.current.delete(timer)
      fn()
    }, delay)
    timersRef.current.add(timer)
    return timer
  }, [])

  const dismissStopNotice = useCallback(() => {
    generationRef.current += 1
    setStopNotice(null)
  }, [])

  const requestStop = useCallback(
    ({
      sessionKey,
      clientId,
    }: {
      sessionKey: string
      clientId?: string | null
    }) => {
      const generation = (generationRef.current += 1)
      const isCurrent = () =>
        mountedRef.current && generationRef.current === generation

      const show = (phase: RunStopPhase) => {
        if (!isCurrent()) return
        setStopNotice({
          phase,
          message: RUN_STOP_COPY[phase],
          tone: TONES[phase],
          confirmed: CONFIRMED[phase],
          sessionKey,
        })
        if (!CONFIRMED[phase]) return
        // Confirmed: the run is over, so the pending-user-message safety net
        // has nothing left to protect. Disarm it and let the notice fade.
        if (clientId) {
          updateHistoryMessageByClientIdEverywhere(
            queryClient,
            clientId,
            (message) => ({ ...message, status: 'sent' }),
          )
        }
        schedule(() => {
          if (!isCurrent()) return
          setStopNotice(null)
        }, RUN_STOP_NOTICE_TTL_MS)
      }

      // Optimistic and immediate — the user pressed a button, they get a
      // response now, not after a round trip that may never come back.
      show('stopping')

      const startedAt = Date.now()

      const poll = (runId: string, errorCount: number) => {
        if (!isCurrent()) return
        const profile = getSessionProfile()
        const query = profile ? `?profile=${encodeURIComponent(profile)}` : ''
        void fetch(`/api/runs/${encodeURIComponent(runId)}/status${query}`, {
          headers: { Accept: 'application/json' },
        })
          .then(async (res) => {
            const data = (await res
              .json()
              .catch(() => ({}))) as RunStatusResponse
            if (!isCurrent()) return

            if (res.ok && data.ok) {
              if (isCancelledRunStatus(data.status)) {
                show('stopped')
                return
              }
              if (isTerminalRunStatus(data.status)) {
                // Completed or failed on its own. Honest, and per the gateway
                // contract the transcript keeps whatever it produced.
                show('finished-first')
                return
              }
              // Still `stopping`/`running`/`queued`.
              if (Date.now() - startedAt >= RUN_STOP_LINGER_MS) {
                show('lingering')
              }
              if (Date.now() - startedAt >= RUN_STOP_POLL_TIMEOUT_MS) return
              schedule(() => poll(runId, 0), RUN_STOP_POLL_MS)
              return
            }

            // The status record is gone (or unreadable). "Record gone" is not
            // "run stopped" — say so rather than claiming a clean stop.
            show('failed')
          })
          .catch(() => {
            if (!isCurrent()) return
            if (errorCount + 1 >= RUN_STOP_POLL_MAX_ERRORS) {
              show('failed')
              return
            }
            schedule(() => poll(runId, errorCount + 1), RUN_STOP_POLL_MS)
          })
      }

      void fetch(`/api/runs/${ACTIVE_RUN_TOKEN}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionKey, ...profileBody() }),
      })
        .then(async (res) => {
          const data = (await res.json().catch(() => ({}))) as RunStopResponse
          if (!isCurrent()) return

          if (res.ok && data.ok && data.runId) {
            // Accepted. 200 means "the flag is set", so keep saying
            // "Stopping…" and let the status poll decide when it is true.
            schedule(() => poll(data.runId as string, 0), RUN_STOP_POLL_MS)
            return
          }

          if (data.benign && data.reason === 'already_finished') {
            show('already-finished')
            return
          }
          if (data.reason === 'not_stoppable') {
            show('unstoppable')
            return
          }
          show('failed')
        })
        .catch(() => {
          show('failed')
        })
    },
    [queryClient, schedule],
  )

  return { requestStop, stopNotice, dismissStopNotice }
}
