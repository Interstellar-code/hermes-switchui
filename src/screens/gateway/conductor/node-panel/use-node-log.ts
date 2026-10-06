/**
 * useNodeLog — a bash/script node's stdout/stderr (backend feature `node_log`).
 *
 * History: newest page first (`GET /runs/{id}/events?type=node_log&node_run_id=…`
 * without `after`); LOAD EARLIER pages forward from the start up to the
 * oldest loaded row (the backend has no `before`). When the node stops (or
 * starts again), new rows are caught up from the cursor with `after`.
 * Live (while the node runs): `node_log` chunks from the host's single run
 * EventSource via `subscribe` — never through the shared 500-event buffer.
 * Rows are deduped by `seq`; a live chunk whose DB write was dropped arrives
 * with `seq: null` and is kept under a synthetic key (it never reaches
 * history, so it cannot duplicate). The engine caps each attempt at 256KB
 * and ends it with a `{text:"", truncated:true}` chunk; the client keeps at
 * most CLIENT_CAP chars, dropping the oldest.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SubscribeNodeLog } from '@/screens/workflows/use-workflow-events'
import type { WorkflowEventRow } from '@/screens/workflows/api-client'
import { listRunEvents } from '@/screens/workflows/api-client'

export interface LogChunk {
  /** React key: the seq, or `n<k>` for a live chunk without one. */
  key: string
  seq: number | null
  /** Sort position: the seq, or (seq-less) the position it arrived at. */
  ord: number
  stream: 'stdout' | 'stderr'
  text: string
  /** First chunk of an attempt (`seq_in_node` 0): a resumed node starts over. */
  first: boolean
  /** The engine's end-of-attempt truncation marker (no text). */
  truncated: boolean
}

export interface NodeLogState {
  chunks: Array<LogChunk>
  loading: boolean
  error: boolean
  /** Rows older than the loaded window exist (LOAD EARLIER). */
  hasEarlier: boolean
  loadingEarlier: boolean
  /** The client cap dropped the oldest output. */
  dropped: boolean
}

export const PAGE = 1000
const MAX_PAGES = 20
export const FLUSH_MS = 250
// ponytail: counts UTF-16 chars, not bytes; close enough for a memory bound.
export const CLIENT_CAP = 512 * 1024

type Parsed = Omit<LogChunk, 'key' | 'ord'>

/** Parse an events row or an SSE envelope; null when it is not this node's log. */
export function toChunk(env: object, nodeRunId: string): Parsed | null {
  const e = env as Partial<Omit<WorkflowEventRow, 'seq'>> & { seq?: unknown }
  if (e.node_run_id !== nodeRunId) return null
  const d = e.data ?? {}
  return {
    seq: typeof e.seq === 'number' ? e.seq : null,
    stream: d.stream === 'stderr' ? 'stderr' : 'stdout',
    text: typeof d.text === 'string' ? d.text : '',
    first: d.seq_in_node === 0,
    truncated: d.truncated === true,
  }
}

export interface Store {
  list: Array<LogChunk>
  seen: Set<number>
  chars: number
  synth: number
  /** Highest history seq (the `after` cursor); null = newest page not loaded. */
  cursor: number | null
  /** Lowest history seq loaded (LOAD EARLIER stops before it). */
  oldest: number | null
  hasEarlier: boolean
  dropped: boolean
}

export const newStore = (): Store => ({
  list: [],
  seen: new Set(),
  chars: 0,
  synth: 0,
  cursor: null,
  oldest: null,
  hasEarlier: false,
  dropped: false,
})

/** Append (or binary-insert an out-of-order seq); false for a duplicate or an empty chunk. */
export function addChunk(st: Store, c: Parsed | null): boolean {
  if (!c) return false
  if (c.seq != null) {
    if (st.seen.has(c.seq)) return false
    st.seen.add(c.seq)
  }
  if (!c.text && !c.truncated) return false
  const last = st.list.at(-1)
  const ord = c.seq ?? last?.ord ?? 0
  const chunk: LogChunk = {
    ...c,
    ord,
    key: c.seq != null ? String(c.seq) : `n${++st.synth}`,
  }
  if (!last || ord >= last.ord) st.list.push(chunk)
  else {
    // Upper bound: after equal ords (a seq-less chunk stays after its seq).
    let lo = 0
    let hi = st.list.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (st.list[mid].ord <= ord) lo = mid + 1
      else hi = mid
    }
    st.list.splice(lo, 0, chunk)
  }
  st.chars += chunk.text.length
  return true
}

/** Drop the oldest chunks until the log fits CLIENT_CAP. */
export function capStore(st: Store, cap = CLIENT_CAP) {
  let n = 0
  while (st.chars > cap && n < st.list.length - 1) {
    st.chars -= st.list[n].text.length
    n++
  }
  if (n === 0) return
  st.list.splice(0, n)
  st.dropped = true
  st.hasEarlier = false
}

export function useNodeLog(opts: {
  runId: string
  nodeRunId: string | null
  /** Load anything at all (tab open + feature present). */
  enabled: boolean
  /** The node is still running: follow the stream. */
  live: boolean
  subscribe?: SubscribeNodeLog
}): NodeLogState & { loadEarlier: () => void } {
  const { runId, nodeRunId, enabled, live, subscribe } = opts
  const on = enabled && !!nodeRunId
  const initial = (): NodeLogState => ({
    chunks: [],
    loading: on,
    error: false,
    hasEarlier: false,
    loadingEarlier: false,
    dropped: false,
  })
  const [state, setState] = useState<NodeLogState>(initial)
  const st = useRef<Store>(newStore())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  const publish = (patch: Partial<NodeLogState> = {}) => {
    clearTimer()
    capStore(st.current)
    const { list, hasEarlier, dropped } = st.current
    setState((s) => ({
      ...s,
      ...patch,
      chunks: list.slice(),
      hasEarlier,
      dropped,
    }))
  }

  // Reset when the target changes (declared first: runs before the loaders).
  useEffect(() => {
    clearTimer()
    st.current = newStore()
    setState(initial())
  }, [runId, nodeRunId, on])

  useEffect(() => clearTimer, [])

  // Live chunks: subscribed before the history fetch so nothing falls between.
  useEffect(() => {
    if (!on || !live || !subscribe || !nodeRunId) return
    return subscribe((env) => {
      if (addChunk(st.current, toChunk(env, nodeRunId)))
        timer.current ??= setTimeout(publish, FLUSH_MS)
    })
  }, [on, live, subscribe, nodeRunId])

  // History: the newest page once; afterwards (node stopped / restarted)
  // catch up forward from the cursor.
  useEffect(() => {
    if (!on || !nodeRunId) return
    // An object, not a let: TS narrows a closed-over `let` to its initial value.
    const ctl = { cancelled: false }
    const s = st.current
    const q = { type: 'node_log', node_run_id: nodeRunId, limit: PAGE }
    const take = (rows: Array<WorkflowEventRow>) => {
      for (const row of rows) {
        addChunk(s, toChunk(row, nodeRunId))
        s.cursor = Math.max(s.cursor ?? 0, row.seq)
        s.oldest = Math.min(s.oldest ?? row.seq, row.seq)
      }
    }
    void (async () => {
      try {
        if (s.cursor == null) {
          const page = await listRunEvents(runId, q)
          if (ctl.cancelled) return
          take(page?.events ?? [])
          s.cursor ??= 0
          s.hasEarlier = (page?.events.length ?? 0) >= PAGE
        } else {
          for (let i = 0; i < MAX_PAGES; i++) {
            const page = await listRunEvents(runId, {
              ...q,
              after: String(s.cursor),
            })
            if (ctl.cancelled) return
            take(page?.events ?? [])
            if (!page || page.events.length < PAGE) break
          }
        }
        publish({ loading: false, error: false })
      } catch {
        if (!ctl.cancelled)
          setState((x) => ({ ...x, loading: false, error: true }))
      }
    })()
    return () => {
      ctl.cancelled = true
    }
  }, [runId, nodeRunId, on, live])

  const loadEarlier = useCallback(() => {
    const s = st.current
    if (!nodeRunId || !s.hasEarlier || s.oldest == null) return
    const stop = s.oldest
    setState((x) => ({ ...x, loadingEarlier: true }))
    void (async () => {
      const rows: Array<WorkflowEventRow> = []
      try {
        let after = '0'
        for (let i = 0; i < MAX_PAGES; i++) {
          const page = await listRunEvents(runId, {
            type: 'node_log',
            node_run_id: nodeRunId,
            limit: PAGE,
            after,
          })
          if (!page) break
          rows.push(...page.events.filter((r) => r.seq < stop))
          const max = page.events.at(-1)?.seq
          if (page.events.length < PAGE || max == null || max >= stop) break
          after = String(max)
        }
      } catch {
        /* keep what loaded */
      }
      if (st.current !== s) return // target changed meanwhile
      // Merge in front (one sort, not one splice per row), then re-cap.
      const kept = s.list
      s.list = []
      for (const r of rows) addChunk(s, toChunk(r, nodeRunId))
      s.list = s.list.concat(kept).sort((a, b) => a.ord - b.ord)
      s.oldest = rows.reduce((m, r) => Math.min(m, r.seq), stop)
      s.hasEarlier = false
      publish({ loadingEarlier: false })
    })()
  }, [runId, nodeRunId])

  return { ...state, loadEarlier }
}
