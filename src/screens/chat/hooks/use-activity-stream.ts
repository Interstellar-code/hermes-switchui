import { useEffect, useState } from 'react'
import type { RefObject } from 'react'

export type LiveToolActivity = Array<{ name: string; timestamp: number }>

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

  const [liveToolActivity, setLiveToolActivity] =
    useState<LiveToolActivity>([])

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
    return () => {
      events.removeEventListener('activity', onActivity)
      events.close()
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
