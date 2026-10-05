/**
 * useNodeLog — a bash/script node's stdout/stderr (backend feature `node_log`).
 *
 * History: paged `GET /runs/{id}/events?type=node_log&node_run_id=…&after=…`.
 * Live (while the node runs): `node_log` chunks from the host's single run
 * EventSource via `subscribe` — never through the shared 500-event buffer.
 * Chunks are ordered and deduped by `seq`; the backend caps a node's log at
 * 256KB and ends it with a `{text:"", truncated:true}` chunk.
 */
import { useEffect, useRef, useState } from 'react'
import type { SubscribeNodeLog } from '@/screens/workflows/use-workflow-events'
import type { WorkflowEventRow } from '@/screens/workflows/api-client'
import { listRunEvents } from '@/screens/workflows/api-client'

export interface LogChunk {
  seq: number
  stream: 'stdout' | 'stderr'
  text: string
  /** First chunk of an attempt (`seq_in_node` 0): a resumed node starts over. */
  first: boolean
}

export interface NodeLogState {
  chunks: Array<LogChunk>
  truncated: boolean
  loading: boolean
  error: boolean
  /** History hit the page cap; older output was not loaded. */
  partial: boolean
}

const PAGE = 1000
const MAX_PAGES = 20
const FLUSH_MS = 250

/** Parse an events row or an SSE envelope; null when it is not this node's log. */
export function toChunk(
  env: object,
  nodeRunId: string,
): (LogChunk & { truncated: boolean }) | null {
  const e = env as Partial<WorkflowEventRow>
  if (e.node_run_id !== nodeRunId || typeof e.seq !== 'number') return null
  const d = e.data ?? {}
  return {
    seq: e.seq,
    stream: d.stream === 'stderr' ? 'stderr' : 'stdout',
    text: typeof d.text === 'string' ? d.text : '',
    first: d.seq_in_node === 0,
    truncated: d.truncated === true,
  }
}

/** Merge into a seq-keyed map; returns the ordered chunks (empty texts dropped). */
export function orderedChunks(bySeq: Map<number, LogChunk>): Array<LogChunk> {
  return [...bySeq.values()].filter((c) => c.text).sort((a, b) => a.seq - b.seq)
}

export function useNodeLog(opts: {
  runId: string
  nodeRunId: string | null
  /** Load anything at all (tab open + feature present). */
  enabled: boolean
  /** The node is still running: follow the stream. */
  live: boolean
  subscribe?: SubscribeNodeLog
}): NodeLogState {
  const { runId, nodeRunId, enabled, live, subscribe } = opts
  const on = enabled && !!nodeRunId
  const [state, setState] = useState<NodeLogState>({
    chunks: [],
    truncated: false,
    loading: on,
    error: false,
    partial: false,
  })
  const bySeq = useRef(new Map<number, LogChunk>())
  const truncated = useRef(false)
  const cursor = useRef<string>('0')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset when the target changes.
  useEffect(() => {
    bySeq.current = new Map()
    truncated.current = false
    cursor.current = '0'
    setState({
      chunks: [],
      truncated: false,
      loading: on,
      error: false,
      partial: false,
    })
  }, [runId, nodeRunId, on])

  const flush = () => {
    timer.current = null
    const chunks = orderedChunks(bySeq.current)
    setState((s) => ({ ...s, chunks, truncated: truncated.current }))
  }
  const add = (c: (LogChunk & { truncated: boolean }) | null) => {
    if (!c || bySeq.current.has(c.seq)) return false
    bySeq.current.set(c.seq, c)
    if (c.truncated) truncated.current = true
    return true
  }
  const schedule = () => {
    timer.current ??= setTimeout(flush, FLUSH_MS)
  }
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
    },
    [],
  )

  // Live chunks: subscribe before the history fetch so nothing falls between.
  useEffect(() => {
    if (!on || !live || !subscribe || !nodeRunId) return
    return subscribe((env) => {
      if (add(toChunk(env, nodeRunId))) schedule()
    })
  }, [on, live, subscribe, nodeRunId])

  // History; re-run (from the last cursor) when the node stops, to catch up.
  useEffect(() => {
    if (!on || !nodeRunId) return
    // An object, not a let: TS narrows a closed-over `let` to its initial value.
    const ctl = { cancelled: false }
    void (async () => {
      try {
        let pages = 0
        for (; pages < MAX_PAGES; pages++) {
          const page = await listRunEvents(runId, {
            type: 'node_log',
            node_run_id: nodeRunId,
            after: cursor.current,
            limit: PAGE,
          })
          if (ctl.cancelled) return
          if (!page) break
          for (const row of page.events) add(toChunk(row, nodeRunId))
          if (page.cursor != null) cursor.current = String(page.cursor)
          if (page.events.length < PAGE) break
        }
        if (ctl.cancelled) return
        setState((s) => ({
          ...s,
          chunks: orderedChunks(bySeq.current),
          truncated: truncated.current,
          loading: false,
          error: false,
          partial: pages >= MAX_PAGES,
        }))
      } catch {
        if (!ctl.cancelled)
          setState((s) => ({ ...s, loading: false, error: true }))
      }
    })()
    return () => {
      ctl.cancelled = true
    }
  }, [runId, nodeRunId, on, live])

  return state
}
