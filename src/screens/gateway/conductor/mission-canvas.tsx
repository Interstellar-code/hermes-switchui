import { Suspense, lazy, useRef, useState } from 'react'
import { StagePills } from './now-playing-strip'
import { useRunDag } from './use-run-dag'
import type { CSSProperties } from 'react'
import type { DagModel } from './dag-model'
import { useFocusTrap } from '@/components/ui/use-focus-trap'
import { nodeColor } from '@/screens/workflows/node-colors'
import { useConductorLayoutStore } from '@/stores/conductor-layout-store'
import { useConductorUIStore } from '@/stores/conductor-ui-store'

/** React Flow lives in its own chunk; the /conductor route is ssr:false. */
export const FlowCanvas = lazy(() => import('./flow/flow-canvas'))

export const graphLoading = (
  <div className="dag-empty" role="status">
    Loading graph…
  </div>
)

/** Type legend: one chip per node type present, in first-seen order. */
function TypeLegend({ dag }: { dag: DagModel }) {
  const types = [...new Set(dag.nodes.map((n) => n.type))]
  return (
    <span className="flow-legend">
      {types.map((t) => (
        <span key={t} style={{ '--node-c': nodeColor(t) } as CSSProperties}>
          <i aria-hidden="true" />
          {t}
        </span>
      ))}
    </span>
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

interface MissionCanvasProps {
  runId: string
  /** Node click / Enter. Defaults to opening the run drawer (F2 docks a node panel). */
  onNodeSelect?: (nodeId: string) => void
  /** Centre the canvas on this node (F2). */
  focusNodeId?: string | null
}

export function MissionCanvas({
  runId,
  onNodeSelect,
  focusNodeId,
}: MissionCanvasProps) {
  const { dag, isLoading, isError, run, workflowId } = useRunDag(runId)
  const setDrawerRunId = useConductorUIStore((s) => s.setDrawerRunId)
  const resetLayout = useConductorLayoutStore((s) => s.resetLayout)
  const [resetKey, setResetKey] = useState(0)
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
        {dag && <TypeLegend dag={dag} />}
        <div className="right">
          {dag && full && <StagePills stages={dag.stages} />}
          {dag && dag.nodes.length > 0 && (
            <>
              <span className="flow-hint">
                drag to arrange · saved for this workflow
              </span>
              <button
                type="button"
                className="flow-reset"
                onClick={() => {
                  if (workflowId) resetLayout(workflowId)
                  setResetKey((k) => k + 1)
                }}
              >
                RESET LAYOUT
              </button>
            </>
          )}
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
        <Suspense fallback={graphLoading}>
          <FlowCanvas
            key={workflowId ?? runId}
            dag={dag}
            workflowId={workflowId}
            onNodeSelect={onNodeSelect ?? (() => setDrawerRunId(runId))}
            focusNodeId={focusNodeId}
            resetKey={resetKey}
          />
        </Suspense>
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
