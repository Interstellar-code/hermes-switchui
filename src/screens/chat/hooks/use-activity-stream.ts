import { useEffect, useState, useSyncExternalStore } from 'react'
import type { RefObject } from 'react'

export type LiveToolActivity = Array<{ name: string; timestamp: number }>

/**
 * History poll cadence while the live `/api/events` stream is down.
 */
export const HISTORY_POLL_INTERVAL_MS = 5_000

/**
 * Slower history poll while the live `/api/events` stream is connected.
 * `/api/events` only carries events for the user's own send runs, so
 * messages that never arrive as stream events for this run (cron turns,
 * Telegram, another browser tab, agent-initiated turns) would be lost
 * without a poll — the connected slow poll covers them.
 */
export const HISTORY_CONNECTED_POLL_INTERVAL_MS = 15_000

/**
 * Pure selector for the history query's `refetchInterval` option:
 * a slow 15 s poll while the live stream is connected (covers external
 * messages that never arrive as stream events for this run — cron,
 * Telegram, other tabs, agent-initiated turns), 5 s when disconnected.
 */
export function resolveHistoryRefetchInterval(
  isLiveStreamConnected: boolean,
): number | false {
  return isLiveStreamConnected
    ? HISTORY_CONNECTED_POLL_INTERVAL_MS
    : HISTORY_POLL_INTERVAL_MS
}

// Shared readout of the ONE `/api/events` EventSource owned by
// `useActivityStream` below (the screen's live stream). Module-level on
// purpose: `useChatHistory` runs earlier in `chat-screen.tsx` than the
// activity hook, so the flag cannot travel through hook return values
// without reordering unrelated hooks. This is the same connection —
// not a second tracker — surfaced via `useSyncExternalStore`.
let liveStreamConnected = false
const liveStreamListeners = new Set<() => void>()

function setLiveStreamConnected(connected: boolean): void {
  if (liveStreamConnected === connected) return
  liveStreamConnected = connected
  for (const listener of Array.from(liveStreamListeners)) listener()
}

function subscribeLiveStream(listener: () => void): () => void {
  liveStreamListeners.add(listener)
  return () => {
    liveStreamListeners.delete(listener)
  }
}

function getLiveStreamSnapshot(): boolean {
  return liveStreamConnected
}

/** Reactive readout: true while the shared `/api/events` SSE stream is open. */
export function useLiveStreamConnected(): boolean {
  return useSyncExternalStore(
    subscribeLiveStream,
    getLiveStreamSnapshot,
    getLiveStreamSnapshot,
  )
}

/**
 * Activity stream cluster — owns the `/api/events` activity EventSource,
 * the `liveToolActivity` pill state, and the clear-on-response effect.
 *
 * Extracted verbatim from `chat-screen.tsx` (pure move, no behavior change).
 *
 * The EventSource stays open for the session lifetime so it is warm before
 * the first tool call fires (avoids connection latency gap). Pills only
 * populate while `waitingForResponseRef.current` is true. When the response
 * arrives (`waitingForResponse` flips false), pills clear after a brief
 * 800 ms delay so the last pill remains visible.
 */
export function useActivityStream(params: {
  /** Read non-reactively inside the activity listener to gate pill insertion. */
  waitingForResponseRef: RefObject<boolean>
  /** Reactive flag — when it flips false, pills clear after a short delay. */
  waitingForResponse: boolean
}): {
  liveToolActivity: LiveToolActivity
} {
  const { waitingForResponseRef, waitingForResponse } = params

  const [liveToolActivity, setLiveToolActivity] = useState<LiveToolActivity>([])

  // Keep activity stream open persistently — opens on mount so it's ready
  // before the first tool call fires (avoids connection latency gap).
  useEffect(() => {
    const events = new EventSource('/api/events')
    const onActivity = (event: MessageEvent) => {
      // Only populate pills while waiting — but connection stays warm always
      if (!waitingForResponseRef.current) return
      try {
        const payload = JSON.parse(event.data) as {
          type?: unknown
          title?: unknown
        }
        if (payload.type !== 'tool' || typeof payload.title !== 'string') {
          return
        }
        const name = payload.title.replace(/^Tool activity:\s*/i, '').trim()
        if (!name) return
        setLiveToolActivity((prev) => {
          const filtered = prev.filter((entry) => entry.name !== name)
          return [{ name, timestamp: Date.now() }, ...filtered].slice(0, 5)
        })
      } catch {
        // Ignore malformed activity events.
      }
    }
    events.addEventListener('activity', onActivity)
    // Surface the SSE connection for history polling: while open the
    // history query slows to a 15 s poll (external messages never arrive
    // as stream events for this run); on error it returns to 5 s polls.
    const onOpen = () => {
      setLiveStreamConnected(true)
    }
    const onError = () => {
      setLiveStreamConnected(false)
    }
    events.addEventListener('open', onOpen)
    events.addEventListener('error', onError)
    return () => {
      events.removeEventListener('activity', onActivity)
      events.removeEventListener('open', onOpen)
      events.removeEventListener('error', onError)
      events.close()
      setLiveStreamConnected(false)
    }
  }, []) // mount only — stays open for session lifetime

  // Clear tool pills after response arrives (with brief delay so last pill is visible)
  useEffect(() => {
    if (waitingForResponse) return
    const timer = window.setTimeout(() => setLiveToolActivity([]), 800)
    return () => window.clearTimeout(timer)
  }, [waitingForResponse])

  return { liveToolActivity }
}
