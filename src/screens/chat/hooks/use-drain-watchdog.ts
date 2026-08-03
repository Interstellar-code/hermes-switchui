import { useEffect, useRef } from 'react'

import { useChatStore } from '../../../stores/chat-store'
import { activeRunUrl, isRecoverableActiveRun } from './use-active-run-check'
import type { ActiveRunSnapshot } from './use-active-run-check'

/**
 * Drain-watchdog escape hatch for the chat message queue (Phase 1.1).
 *
 * The queue drains on the falling edge of `isComposerLoading` (see the drain
 * effect in chat-screen.tsx). If an SSE completion event is dropped, the busy
 * signals (chiefly `waitingForResponse`) never clear, `isComposerLoading` stays
 * truthy forever, and the queue stalls permanently — for up to the 120s waiting
 * TTL, and longer if other local signals stick.
 *
 * This watchdog ARMS whenever the composer is busy for the active session
 * (a run is in flight). When SSE has gone silent for
 * `DRAIN_WATCHDOG_IDLE_MS`, it consults the liveness authority
 * (`GET /api/sessions/:sessionKey/active-run`) exactly once:
 *
 *   - Recoverable snapshot  → the run is genuinely live (just slow). Do NOTHING;
 *     keep waiting. This is the guard against premature drain.
 *   - Not-recoverable (null / done) → the run finished server-side but the
 *     client missed the completion. Invoke `reconcile()` to release the stuck
 *     busy state. The EXISTING drain effect then dequeues and sends — this hook
 *     never dequeues, to avoid a double-send.
 *   - Backend unreachable (all retries failed / timed out, e.g. the gateway is
 *     mid `/restart`) → the run is neither streaming nor confirmable, so an
 *     eternal spinner is misleading. Reconcile too. If the run is actually
 *     still live, `useActiveRunCheck` clears the interrupted flag on its next
 *     poll, so a false positive self-heals.
 *
 * No blind timeout drain on a REACHABLE-but-live backend: a recoverable
 * snapshot always wins, so a slow run is never force-terminated.
 */

export const DRAIN_WATCHDOG_IDLE_MS = 5_000

// How often we re-check the "SSE has gone silent" condition while armed. The
// watchdog only fetches when `now - lastEventAt >= DRAIN_WATCHDOG_IDLE_MS`, so
// this is a cheap clock tick, not a network poll.
const DRAIN_WATCHDOG_TICK_MS = 1_000

// Mirror use-active-run-check.ts retry behaviour so a transient fetch failure
// does not permanently disarm the escape hatch.
const DRAIN_WATCHDOG_FETCH_RETRY_MS = 1_500
const DRAIN_WATCHDOG_FETCH_MAX_ATTEMPTS = 3
// Per-attempt timeout so a hanging proxy (gateway mid-restart) can't wedge the
// probe in-flight forever, blocking every later tick.
const DRAIN_WATCHDOG_FETCH_TIMEOUT_MS = 8_000

type ActiveRunResponse = {
  ok: boolean
  run: ActiveRunSnapshot | null
}

export function useDrainWatchdog({
  sessionKey,
  isComposerLoading,
  reconcile,
}: {
  /** The active queue session key (already resolved by the caller). */
  sessionKey: string
  /** Current composer busy state — the sole gate the drain effect waits on. */
  isComposerLoading: boolean
  /**
   * Releases the stuck busy state so the existing drain effect can fire. The
   * caller wires this to the happy-path finalize routine (clear the active-send
   * ref + `streamFinish()` + clear stuck streaming state). MUST NOT dequeue or
   * send — that stays the drain effect's job.
   */
  reconcile: (sessionKey: string) => void
}): void {
  // Keep the latest reconcile callback without re-arming the effect each render.
  const reconcileRef = useRef(reconcile)
  useEffect(() => {
    reconcileRef.current = reconcile
  }, [reconcile])

  // Arm whenever the composer is busy. A live run can lose its SSE completion
  // two ways: a dropped completion event, OR the gateway restarting mid-stream
  // with NO queued message behind it. The old gate (non-empty queue) missed the
  // common single-message case, so the thinking bubble stayed stuck until the
  // 120s waiting TTL. `reconcile` decides what to do: drain if queued, otherwise
  // surface the interrupted affordance (see the wiring in chat-screen.tsx).
  const isArmed = isComposerLoading

  useEffect(() => {
    if (!isArmed || !sessionKey || sessionKey === 'new') return

    const controller = new AbortController()
    let tickTimer: number | null = null
    let retryTimer: number | null = null
    let fetchInFlight = false
    // Guard against acting more than once per armed window.
    let reconciledOrLive = false

    async function probe() {
      let attempts = 0

      async function attempt(): Promise<void> {
        attempts += 1
        try {
          const response = await fetch(
            activeRunUrl(sessionKey),
            {
              signal: AbortSignal.any([
                controller.signal,
                AbortSignal.timeout(DRAIN_WATCHDOG_FETCH_TIMEOUT_MS),
              ]),
            },
          )
          if (!response.ok)
            throw new Error(`Drain watchdog check failed: ${response.status}`)

          const data = (await response.json()) as ActiveRunResponse
          if (!data.ok) throw new Error('Drain watchdog check returned an error')

          if (isRecoverableActiveRun(data.run)) {
            // Genuinely live — never force terminal while a run streams.
            // Stop probing for this armed window; keep waiting.
            reconciledOrLive = true
            return
          }

          // Server says the run is done but the client missed the completion.
          // Release the stuck busy state; the existing drain effect takes over.
          reconciledOrLive = true
          reconcileRef.current(sessionKey)
        } catch (error) {
          // Unmount (not a timeout) — the outer controller was aborted. Bail.
          if (controller.signal.aborted) return
          if (attempts < DRAIN_WATCHDOG_FETCH_MAX_ATTEMPTS) {
            retryTimer = window.setTimeout(() => {
              void attempt()
            }, DRAIN_WATCHDOG_FETCH_RETRY_MS)
            return
          }
          // Backend unreachable after every retry (e.g. the gateway is mid
          // /restart). The run is neither streaming nor confirmable, so an
          // eternal "thinking" spinner is misleading — reconcile so the wired
          // handler surfaces the interrupted/resend affordance. If the run is
          // actually still live, useActiveRunCheck clears the interrupted flag
          // on its next poll, so this false positive self-heals.
          reconciledOrLive = true
          reconcileRef.current(sessionKey)
        }
      }

      await attempt()
    }

    function tick() {
      if (controller.signal.aborted || reconciledOrLive) return

      const lastEventAt = useChatStore.getState().lastEventAt
      const idleFor = Date.now() - lastEventAt
      if (idleFor >= DRAIN_WATCHDOG_IDLE_MS && !fetchInFlight) {
        fetchInFlight = true
        void probe().finally(() => {
          fetchInFlight = false
        })
      }

      // probe() resolves on a later microtask, so reconciledOrLive flips after
      // this synchronous pass. Always reschedule; the guard at the top of the
      // next tick (and the unmount cleanup) is what actually stops the loop.
      tickTimer = window.setTimeout(tick, DRAIN_WATCHDOG_TICK_MS)
    }

    // First tick on the next macrotask so a freshly-arrived event (which updates
    // lastEventAt) is reflected before we measure silence.
    tickTimer = window.setTimeout(tick, DRAIN_WATCHDOG_TICK_MS)

    return () => {
      controller.abort()
      if (tickTimer) window.clearTimeout(tickTimer)
      if (retryTimer) window.clearTimeout(retryTimer)
    }
  }, [isArmed, sessionKey])
}
