/**
 * useKanbanEvents — live Kanban event stream via Workspace SSE proxy.
 *
 * Connects to /api/hermes-kanban/events (which proxies the Agent dashboard WS).
 * Calls onEvent for each received event so the board can invalidate queries.
 *
 * Falls back gracefully: if SSE fails or is unavailable, the caller's
 * polling refetchInterval takes over as the primary sync mechanism.
 *
 * Security: the browser never connects directly to the Agent dashboard.
 * The Workspace issues a one-time token via /api/hermes-kanban/events-token.
 */
import { useEffect, useRef } from 'react'

type KanbanEvent = {
  id?: number
  task_id?: string
  event_type?: string
  error?: string
}

type Options = {
  since?: number
  enabled?: boolean
  onEvent: (event: KanbanEvent) => void
  onLatestEventId?: (id: number) => void
}

export function useKanbanEvents({ since = 0, enabled = true, onEvent, onLatestEventId }: Options) {
  const esRef = useRef<EventSource | null>(null)
  const sinceRef = useRef(since)
  sinceRef.current = since

  useEffect(() => {
    if (!enabled) return

    let active = true
    let es: EventSource | null = null

    async function connect() {
      if (!active) return

      // Obtain a one-time stream token from the Workspace server
      let token: string
      try {
        const res = await fetch('/api/hermes-kanban/events-token')
        if (!res.ok) {
          // Workspace server unavailable or unauthenticated — fall back to polling
          return
        }
        const data = (await res.json()) as { token: string }
        token = data.token
      } catch {
        return // Fail silently; polling refetchInterval handles sync
      }

      if (!active) return

      const url = `/api/hermes-kanban/events?token=${encodeURIComponent(token)}&since=${sinceRef.current}`
      es = new EventSource(url)
      esRef.current = es

      es.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data as string) as KanbanEvent
          if (event.error) {
            es?.close()
            esRef.current = null
            return
          }
          onEvent(event)
          if (typeof event.id === 'number') {
            sinceRef.current = event.id
            onLatestEventId?.(event.id)
          }
        } catch {
          // Ignore unparseable messages
        }
      }

      es.onerror = () => {
        es?.close()
        esRef.current = null
        // Reconnect after 10 seconds on error
        if (active) {
          setTimeout(() => { if (active) void connect() }, 10_000)
        }
      }
    }

    void connect()

    return () => {
      active = false
      es?.close()
      esRef.current = null
    }
  }, [enabled]) // eslint-disable-line react-hooks/exhaustive-deps
}
