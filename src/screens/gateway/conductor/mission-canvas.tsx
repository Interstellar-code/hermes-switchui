import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { StagePills } from './now-playing-strip'
import {
  NODE_H,
  NODE_W,
  edgePath,
  fitScale,
  fmtDuration,
  layoutDag,
} from './dag-layout'
import { loopBadge } from './dag-model'
import { useRunDag } from './use-run-dag'
import type { Point } from './dag-layout'
import type { DagModel, DagNode } from './dag-model'
import { compactTokens } from '@/lib/format-usage'
import { useFocusTrap } from '@/components/ui/use-focus-trap'
import { useConductorUIStore } from '@/stores/conductor-ui-store'

const STATUS_CLASS: Record<string, string> = {
  running: 'run',
  completed: 'done',
  failed: 'fail',
  paused: 'hold',
}

function nodeClass(status: string): string {
  return (
    STATUS_CLASS[status] ??
    (status === 'skipped' || status === 'cancelled' ? 'skip' : 'wait')
  )
}

function statusLine(n: DagNode, now: number): string {
  switch (n.status) {
    case 'running':
      return `● running ${fmtDuration(now - (n.startedAt ?? now))}`
    case 'completed':
      return `✓ ${n.startedAt && n.completedAt ? fmtDuration(n.completedAt - n.startedAt) : 'done'}`
    case 'failed':
      return '✗ failed'
    case 'paused':
      return '⏸ needs approval'
    case 'skipped':
      return 'skipped'
    case 'cancelled':
      return 'cancelled'
    default:
      return 'waiting'
  }
}

/** Ticks once a second while `active`, so running nodes show a live timer. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

interface DagViewProps {
  dag: DagModel
  /** Preview mode: dimmed, dashed, not focusable. */
  preview?: boolean
  /** Enter / click on a node. */
  onOpenNode?: () => void
}

/** Flat layered DAG: HTML nodes over one SVG edge layer, auto-fit to the viewport. */
export function DagView({ dag, preview = false, onOpenNode }: DagViewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ width: 0, height: 0 })
  const layout = useMemo(() => layoutDag(dag), [dag])
  const now = useNow(dag.nodes.some((n) => n.status === 'running'))

  useLayoutEffect(() => {
    const el = hostRef.current
    if (!el) return
    const measure = () =>
      setView({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Keep the running / paused node visible when the graph scrolls horizontally.
  const activeId = dag.nodes.find(
    (n) => n.status === 'running' || n.status === 'paused',
  )?.id
  useEffect(() => {
    if (!activeId) return
    hostRef.current
      ?.querySelector(`[data-node-id="${CSS.escape(activeId)}"]`)
      ?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [activeId])

  const scale = fitScale(layout, view)
  const nodeById = new Map(dag.nodes.map((n) => [n.id, n]))

  return (
    <div className="dag-host" ref={hostRef}>
      <div
        className="dag-sizer"
        style={{ width: layout.width * scale, height: layout.height * scale }}
      >
        <div
          className={`dag-stage${preview ? ' preview' : ''}`}
          style={{
            width: layout.width,
            height: layout.height,
            transform: `scale(${scale})`,
          }}
        >
          <svg
            className="dag-edges"
            width={layout.width}
            height={layout.height}
            aria-hidden="true"
          >
            {dag.edges.map(([a, b]) => {
              const from = layout.positions[a] as Point | undefined
              const to = layout.positions[b] as Point | undefined
              if (!from || !to) return null
              const src = nodeById.get(a)?.status
              const dst = nodeById.get(b)?.status
              const cls =
                src === 'completed' && dst === 'running'
                  ? 'live'
                  : src === 'completed' && dst === 'completed'
                    ? 'done'
                    : src === 'failed'
                      ? 'fail'
                      : ''
              return (
                <path
                  key={`${a}>${b}`}
                  className={`dag-edge ${cls}`}
                  d={edgePath(from, to)}
                />
              )
            })}
          </svg>
          {dag.nodes.map((n) => {
            const pos = layout.positions[n.id]
            const badge = loopBadge(n.loop)
            const cls = `dn ${nodeClass(n.status)}`
            const body = (
              <>
                <span className="k">
                  {n.stage} · {n.type}
                  {badge && <span className="loop"> ↻ {badge}</span>}
                  {n.tokens != null && n.tokens > 0 && (
                    <span className="tok">
                      {' '}
                      · {compactTokens(n.tokens)} tok
                    </span>
                  )}
                </span>
                <span className="nm">{n.label}</span>
                <span className="s">
                  {preview ? n.type : statusLine(n, now)}
                </span>
              </>
            )
            const attrs = { 'data-node-id': n.id }
            const style = {
              left: pos.x,
              top: pos.y,
              width: NODE_W,
              height: NODE_H,
            }
            return preview || !onOpenNode ? (
              <div key={n.id} className={cls} style={style} {...attrs}>
                {body}
              </div>
            ) : (
              <button
                key={n.id}
                type="button"
                className={cls}
                style={style}
                {...attrs}
                onClick={onOpenNode}
                aria-label={`${n.label}, ${n.status === 'idle' ? 'waiting' : n.status}. Open run details`}
              >
                {body}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const EXPAND_ICON = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    aria-hidden="true"
  >
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </svg>
)

export function MissionCanvas({ runId }: { runId: string }) {
  const { dag, isLoading, isError, run } = useRunDag(runId)
  const setDrawerRunId = useConductorUIStore((s) => s.setDrawerRunId)
  const [full, setFull] = useState(false)
  const wrapRef = useRef<HTMLElement>(null)

  // Trap stack: the detail drawer (opened later) sits on top, so one Esc closes only it.
  useFocusTrap(full, wrapRef, () => setFull(false))

  return (
    <section
      ref={wrapRef}
      className={`dag-wrap${full ? ' full' : ''}`}
      aria-label="Mission flow"
    >
      <div className="dag-head">
        <h3>Mission flow</h3>
        {dag && (
          <span className="ct">
            {dag.nodes.length} nodes · {dag.edges.length} edges
            {dag.hiddenCount > 0 && ` · +${dag.hiddenCount} more`}
          </span>
        )}
        <div className="right">
          {dag && full && <StagePills stages={dag.stages} />}
          <button
            type="button"
            className="ico-btn"
            title={full ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
            aria-label={full ? 'Exit fullscreen' : 'Fullscreen'}
            aria-pressed={full}
            onClick={() => setFull((f) => !f)}
          >
            {EXPAND_ICON}
          </button>
        </div>
      </div>
      {dag && dag.nodes.length > 0 ? (
        <DagView dag={dag} onOpenNode={() => setDrawerRunId(runId)} />
      ) : (
        <div className="dag-empty" role="status">
          {isLoading
            ? 'Loading graph…'
            : isError || !run
              ? 'Graph unavailable for this run.'
              : 'This workflow has no nodes.'}
        </div>
      )}
    </section>
  )
}
