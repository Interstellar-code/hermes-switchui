import { useEffect, useRef, useState } from 'react'

export interface WorkflowSseEvent {
  type: string
  data: Record<string, unknown>
  receivedAt: number
}

const MAX_BUFFER = 500
const FLUSH_INTERVAL_MS = 80

export function useWorkflowEvents(conversationId: string | null): {
  events: WorkflowSseEvent[]
  status: 'idle' | 'connecting' | 'open' | 'error' | 'closed'
} {
  const [events, setEvents] = useState<WorkflowSseEvent[]>([])
  const [status, setStatus] = useState<'idle' | 'connecting' | 'open' | 'error' | 'closed'>('idle')
  const esRef = useRef<EventSource | null>(null)
  // Buffer + timer: SSE bursts (workflow completion, node fan-out) used to
  // queue one setState per event, freezing the panel. We batch into a ref
  // and flush every FLUSH_INTERVAL_MS so React sees at most one update per
  // animation-frame-ish window regardless of incoming event rate.
  const bufferRef = useRef<Array<WorkflowSseEvent>>([])
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!conversationId) {
      setStatus('idle')
      setEvents([])
      return
    }

    // Close any existing connection before opening a new one
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    bufferRef.current = []

    setStatus('connecting')
    setEvents([])

    const url = `/api/workflow-events?conversation_id=${encodeURIComponent(conversationId)}`
    const es = new EventSource(url)
    esRef.current = es

    const flush = () => {
      flushTimerRef.current = null
      const incoming = bufferRef.current
      if (incoming.length === 0) return
      bufferRef.current = []
      setEvents((prev) => {
        const next = prev.length === 0 ? incoming : prev.concat(incoming)
        return next.length > MAX_BUFFER ? next.slice(next.length - MAX_BUFFER) : next
      })
    }

    const pushEvent = (type: string, raw: string) => {
      let data: Record<string, unknown> = {}
      try {
        data = JSON.parse(raw) as Record<string, unknown>
      } catch {
        data = { raw }
      }
      bufferRef.current.push({ type, data, receivedAt: Date.now() })
      if (flushTimerRef.current === null) {
        flushTimerRef.current = setTimeout(flush, FLUSH_INTERVAL_MS)
      }
    }

    es.addEventListener('connected', (e: MessageEvent) => {
      setStatus('open')
      pushEvent('connected', e.data)
    })

    es.addEventListener('error', () => {
      setStatus('error')
    })

    // Generic message handler picks up all named event types from the server
    es.onmessage = (e: MessageEvent) => {
      pushEvent('message', e.data)
    }

    // Forward all workflow event types
    const workflowEventTypes = [
      'workflow_started', 'workflow_completed', 'workflow_failed', 'workflow_cancelled',
      'workflow_artifact',
      'node_started', 'node_completed', 'node_failed', 'node_skipped',
      'node_skipped_prior_success',
      'loop_iteration_started', 'loop_iteration_completed', 'loop_iteration_failed',
      'subgraph_started', 'subgraph_completed', 'subgraph_failed',
      'tool_called', 'tool_completed',
      'ralph_story_started', 'ralph_story_completed', 'ralph_story_failed',
      'approval_requested', 'approval_received',
      'platform_message', 'platform_chunk', 'platform_retract',
    ] as const

    for (const type of workflowEventTypes) {
      es.addEventListener(type, (e: MessageEvent) => pushEvent(type, e.data))
    }

    return () => {
      es.close()
      esRef.current = null
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
      }
      bufferRef.current = []
      setStatus('closed')
    }
  }, [conversationId])

  return { events, status }
}
