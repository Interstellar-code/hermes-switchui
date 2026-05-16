import { useState, useEffect, useCallback, useRef } from 'react'

// ── Types ────────────────────────────────────────────────────────

export type AgentStatus = 'active' | 'idle' | 'blocked'

export type AgentNode = {
  id: string
  name: string
  status: AgentStatus
  position: [number, number, number]
  deskLabel: string
  model: string | null
  messageCount: number
  toolCallCount: number
  origin: 'local' | 'a2a-inbound' // reserved for Phase 5
}

// ── Constants ────────────────────────────────────────────────────

/** Fixed desk positions — agents are sorted alphabetically by name and slotted. */
const DESK_POSITIONS: [number, number, number][] = [
  [-4.4, 0, -1.8],
  [-1.3, 0, 1.55],
  [1.9, 0, -1.25],
  [4.75, 0, 1.75],
]

const DESK_LABELS = ['OPS', 'INTEL', 'FORGE', 'WATCH']

/** Spillover row along back wall when sessions > desk count. */
function spilloverPosition(index: number): [number, number, number] {
  const start = -4.4
  const step = 1.8
  return [start + index * step, 0, -3.2]
}

const POLL_INTERVAL_MS = 10_000

// ── Session shape from /api/sessions ─────────────────────────────

type SessionSummary = {
  key: string
  id: string
  title?: string | null
  label?: string | null
  model?: string | null
  message_count?: number
  tool_call_count?: number
  source?: string
  startedAt?: number
  updatedAt?: number
}

// ── Status heuristic ─────────────────────────────────────────────

function inferStatus(session: SessionSummary): AgentStatus {
  // If updated in last 60s → active
  const updated = session.updatedAt ?? session.startedAt ?? 0
  if (updated > 0 && Date.now() - updated < 60_000) return 'active'
  // Has messages but not recently → idle
  if ((session.message_count ?? 0) > 0) return 'idle'
  return 'idle'
}

// ── Hook ─────────────────────────────────────────────────────────

export function useAgentPositions(): {
  agents: AgentNode[]
  loading: boolean
  error: string | null
  refetch: () => void
} {
  const [agents, setAgents] = useState<AgentNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const fetchSessions = useCallback(async () => {
    try {
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl

      const res = await fetch('/api/sessions', { signal: ctrl.signal })
      if (!res.ok) throw new Error(`Sessions API ${res.status}`)

      const data = await res.json()
      const sessions: SessionSummary[] = data.sessions ?? []

      // Filter to non-default, has activity
      const active = sessions
        .filter((s) => s.key && s.source !== 'unavailable')
        .sort((a, b) => (a.label ?? a.key).localeCompare(b.label ?? b.key))

      const mapped: AgentNode[] = active.map((s, idx) => {
        const isSpillover = idx >= DESK_POSITIONS.length
        return {
          id: s.key,
          name: s.label || s.title || s.key.slice(0, 8),
          status: inferStatus(s),
          position: isSpillover
            ? spilloverPosition(idx - DESK_POSITIONS.length)
            : DESK_POSITIONS[idx],
          deskLabel: isSpillover
            ? `R${idx - DESK_POSITIONS.length + 1}`
            : DESK_LABELS[idx],
          model: s.model ?? null,
          messageCount: s.message_count ?? 0,
          toolCallCount: s.tool_call_count ?? 0,
          origin: 'local' as const,
        }
      })

      setAgents(mapped)
      setError(null)
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Failed to fetch sessions')
    } finally {
      setLoading(false)
    }
  }, [])

  // SSE subscription for live updates
  useEffect(() => {
    fetchSessions() // initial fetch

    let eventSource: EventSource | null = null
    let pollTimer: ReturnType<typeof setInterval> | null = null

    // Try SSE first
    try {
      eventSource = new EventSource('/api/chat-events')

      const relevantEvents = new Set([
        'session-started',
        'session-ended',
        'session-status-changed',
        'session-error',
        'message-complete',
        'tool-call',
      ])

      eventSource.onmessage = (e) => {
        // SSE events come with named events, but onmessage catches unnamed
        // We refetch on any activity since the data is lightweight
      }

      // Listen for specific named events
      for (const evt of relevantEvents) {
        eventSource.addEventListener(evt, () => {
          fetchSessions()
        })
      }

      // Fallback: if SSE connects but we also want a safety poll
      eventSource.addEventListener('heartbeat', () => {
        // no-op, just keeps the connection alive
      })

      eventSource.onerror = () => {
        // SSE failed → fall back to polling
        eventSource?.close()
        eventSource = null
        if (!pollTimer) {
          pollTimer = setInterval(fetchSessions, POLL_INTERVAL_MS)
        }
      }
    } catch {
      // SSE not available → poll
      pollTimer = setInterval(fetchSessions, POLL_INTERVAL_MS)
    }

    // Safety poll: refresh every 30s regardless of SSE
    // (SSE may miss events if bus hasn't started)
    pollTimer = setInterval(fetchSessions, 30_000)

    return () => {
      eventSource?.close()
      if (pollTimer) clearInterval(pollTimer)
      abortRef.current?.abort()
    }
  }, [fetchSessions])

  return { agents, loading, error, refetch: fetchSessions }
}
