import { useEffect, useMemo, useRef, useState } from 'react'
import { nodeColor } from '../node-colors'
import { DEFAULT_CHIPS, EVENT_CHIPS, filterEvents } from './events-model'
import { TERMINAL, fmtTime } from './inspector-model'
import type { EventChip, EventItem } from './events-model'
import type { CSSProperties } from 'react'
import type { InspectorCtx } from './inspector-model'

function kindClass(type: string) {
  if (type.endsWith('_failed')) return 'k-er'
  if (type.endsWith('_completed')) return 'k-ok'
  if (type === 'node_started') return 'k-st'
  if (type === 'node_skipped' || type.startsWith('node_skipped')) return 'k-sk'
  if (type === 'node_paused' || type.startsWith('approval')) return 'k-ap'
  return 'k-wf'
}

export function EventsTab({
  ctx,
  items,
  historyNote,
  streamStatus,
  nodeFilter,
  onNodeFilter,
}: {
  ctx: InspectorCtx
  items: Array<EventItem>
  /** Footer caveat about DB history coverage; null = complete. */
  historyNote: string | null
  streamStatus: string
  nodeFilter: string | null
  onNodeFilter: (id: string | null) => void
}) {
  const [chips, setChips] = useState<Set<EventChip>>(new Set(DEFAULT_CHIPS))
  const [search, setSearch] = useState('')
  const [follow, setFollow] = useState(true)
  const logRef = useRef<HTMLDivElement>(null)
  const { run, nodeRuns } = ctx
  const nodeTypes = useMemo(
    () => new Map(nodeRuns.map((n) => [n.dag_node_id, n.node_type])),
    [nodeRuns],
  )
  const nodeNames = useMemo(
    () => [
      ...new Set(items.map((e) => e.nodeId).filter((n): n is string => !!n)),
    ],
    [items],
  )
  const shown = useMemo(
    () => filterEvents(items, { node: nodeFilter, chips, search }),
    [items, nodeFilter, chips, search],
  )
  const ended = TERMINAL.has(run.status)
  const lastTs = items.length ? items[items.length - 1].ts : null
  const live =
    !ended && (streamStatus === 'open' || streamStatus === 'connecting')

  useEffect(() => {
    if (follow && logRef.current)
      logRef.current.scrollTop = logRef.current.scrollHeight
  }, [shown.length, follow])

  const toggle = (c: EventChip) =>
    setChips((prev) => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c)
      else next.add(c)
      return next
    })

  const exportJson = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          shown.map((e) => ({
            time: new Date(e.ts).toISOString(),
            type: e.type,
            node: e.nodeId,
            summary: e.summary,
            data: e.data,
          })),
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `run-${run.id.slice(0, 8)}-events.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="wfri-events">
      <div className="wfri-fb" role="toolbar" aria-label="Event filters">
        <label className="wfri-meta" htmlFor="wfri-evnode">
          NODE
        </label>
        <select
          id="wfri-evnode"
          className="wfri-sel"
          value={nodeFilter ?? ''}
          onChange={(e) => onNodeFilter(e.target.value || null)}
        >
          <option value="">all nodes ({nodeNames.length})</option>
          {nodeFilter && !nodeNames.includes(nodeFilter) && (
            <option value={nodeFilter}>{nodeFilter}</option>
          )}
          {nodeNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        {EVENT_CHIPS.map((c) => (
          <button
            key={c}
            type="button"
            className="wfri-fc"
            aria-pressed={chips.has(c)}
            onClick={() => toggle(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="wfri-fb">
        <input
          type="search"
          className="wfri-search"
          placeholder="search messages"
          aria-label="Search events"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="wfri-tg">
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => setFollow(e.target.checked)}
          />
          FOLLOW LIVE
        </label>
        <span className="wfri-grow" />
        <span className={`wfri-lv${live ? ' on' : ''}`}>
          <span className="wfri-pulse" aria-hidden="true" />
          {live ? 'LIVE · SSE' : 'ENDED'}
        </span>
        <span className="wfri-meta">
          {shown.length} of {items.length} events
        </span>
      </div>
      <div
        ref={logRef}
        className="wfri-log"
        role="log"
        aria-live="polite"
        aria-label="Run events, newest at bottom"
      >
        {shown.length === 0 && (
          <div className="wfri-empty">No events match the filters.</div>
        )}
        {shown.map((e) => (
          <div
            key={e.key}
            className={`wfri-ev${e.type.endsWith('_failed') ? ' fail' : ''}`}
          >
            <span className="t">{fmtTime(e.ts)}</span>
            <span className={`k ${kindClass(e.type)}`}>{e.type}</span>
            <span className="n">
              {e.nodeId ? (
                <>
                  <i
                    className="wfri-dot"
                    style={
                      {
                        '--node-c': nodeColor(
                          nodeTypes.get(e.nodeId) ?? 'prompt',
                        ),
                      } as CSSProperties
                    }
                  />
                  {e.nodeId}
                </>
              ) : (
                <span className="wfri-na">run</span>
              )}
            </span>
            <span className="m">{e.summary}</span>
          </div>
        ))}
      </div>
      <div className="wfri-ft">
        <span>
          newest at bottom · {follow ? 'following' : 'paused'}
          {historyNote ? ` · ${historyNote}` : ''}
        </span>
        <span className="wfri-grow" />
        <span>
          {live
            ? 'stream connected'
            : `stream closed${lastTs ? ` · no events since ${fmtTime(lastTs)}${ended ? ' (run ended)' : ''}` : ''}`}
        </span>
        <button type="button" className="wfri-btn" onClick={exportJson}>
          EXPORT JSON
        </button>
      </div>
    </div>
  )
}
