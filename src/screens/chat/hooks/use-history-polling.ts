import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

/**
 * History polling cluster — owns the three "refetch history on return"
 * mechanisms that fire when the user comes back to a chat:
 *
 *  1. `claude:chat-refresh` window-event listener  — other tabs/screens ask
 *     this tab to refresh its history.
 *  2. `visibilitychange` bounded poll loop (Issue #208) — when the tab
 *     becomes visible and we are still waiting for a response, one refetch
 *     may not be enough, so we keep polling every 3 s up to 20 times (60 s
 *     cap) until `waitingForResponse` clears.
 *  3. Re-mount catch-up — navigating back to chat re-mounts the component;
 *     if a response finished while away, the initial refetch may hit stale
 *     data, so we schedule a 2 s delayed refetch and (if still waiting) the
 *     same bounded poll loop.
 *
 * Extracted verbatim from `chat-screen.tsx` (pure move, no behavior change).
 *
 * The overlap guard (`returnPollActiveRef`) ensures at most one bounded poll
 * loop runs at a time across the visibility + remount effects.
 */
export function useHistoryPolling(params: {
  /** `historyQuery.refetch` (or any zero-arg refetch function). */
  refetchHistory: () => void
  /** Read non-reactively inside the poll loops to decide when to stop. */
  waitingForResponseRef: RefObject<boolean>
}): void {
  const { refetchHistory, waitingForResponseRef } = params

  useEffect(() => {
    const handleRefreshRequest = () => {
      refetchHistory()
    }
    window.addEventListener('claude:chat-refresh', handleRefreshRequest)
    return () => {
      window.removeEventListener('claude:chat-refresh', handleRefreshRequest)
    }
  }, [refetchHistory])

  // Overlap guard: ensures at most one poll-until-done loop runs at a time.
  const returnPollActiveRef = useRef(false)

  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState !== 'visible') return
      // Always do one immediate refetch on return (existing behaviour).
      refetchHistory()

      // Issue #208 (RC2): if the session is still waiting for a response when
      // the tab becomes visible again, one refetch may not be enough — the
      // answer might not be committed to history yet.  Start a bounded poll
      // loop (up to 20 × 3 s = 60 s) that keeps re-fetching until the
      // answer lands (waitingForResponse clears) or the cap is hit.
      if (!waitingForResponseRef.current) return
      if (returnPollActiveRef.current) return // another loop already running
      returnPollActiveRef.current = true
      let attempt = 0
      const POLL_INTERVAL_MS = 3_000
      const POLL_MAX_ATTEMPTS = 20
      function scheduleNext() {
        if (!returnPollActiveRef.current) return // cleanup cancelled us
        if (!waitingForResponseRef.current) {
          returnPollActiveRef.current = false
          return // answer arrived — stop
        }
        if (attempt >= POLL_MAX_ATTEMPTS) {
          returnPollActiveRef.current = false
          return // cap reached — stop
        }
        attempt++
        window.setTimeout(() => {
          refetchHistory()
          scheduleNext()
        }, POLL_INTERVAL_MS)
      }
      scheduleNext()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      returnPollActiveRef.current = false // cancel any in-flight loop
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [refetchHistory, waitingForResponseRef]) // waitingForResponseRef is a stable ref — no dep needed

  // Re-mount catch-up: when navigating back to chat from another tab (Skills,
  // Memory, etc.), the component re-mounts. If a response finished while we
  // were away, the initial refetch may hit stale data.  When still waiting,
  // run the same bounded poll loop so we keep retrying until the answer lands.
  // See: https://github.com/outsourc-e/hermes-workspace/issues/43, #208
  useEffect(() => {
    // Always schedule the original 2 s delayed refetch.
    const timer = window.setTimeout(() => {
      refetchHistory()
    }, 2000)

    // If waiting, also start the bounded poll loop (guard against overlap with
    // the visibilitychange loop via the shared returnPollActiveRef).
    if (waitingForResponseRef.current && !returnPollActiveRef.current) {
      returnPollActiveRef.current = true
      let attempt = 0
      const POLL_INTERVAL_MS = 3_000
      const POLL_MAX_ATTEMPTS = 20
      function scheduleNext() {
        if (!returnPollActiveRef.current) return
        if (!waitingForResponseRef.current) {
          returnPollActiveRef.current = false
          return
        }
        if (attempt >= POLL_MAX_ATTEMPTS) {
          returnPollActiveRef.current = false
          return
        }
        attempt++
        window.setTimeout(() => {
          refetchHistory()
          scheduleNext()
        }, POLL_INTERVAL_MS)
      }
      scheduleNext()
    }

    return () => {
      window.clearTimeout(timer)
      returnPollActiveRef.current = false
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- mount-only; waitingForResponseRef + returnPollActiveRef are stable refs
}
