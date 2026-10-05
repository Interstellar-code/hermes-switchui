/**
 * NodePanel — docked right of the canvas (not modal). Tabs: OVERVIEW · OUTPUT
 * · EVENTS. Approval nodes embed the shared ApprovalCard; failed nodes lead
 * with the error and stderr tail.
 */
import { useEffect, useMemo, useRef } from 'react'
import '@/styles/conductor-node-panel.css'
import { useNow } from '../flow/use-now'
import { useRunDag } from '../use-run-dag'
import { NodeEvents } from './node-events'
import { NodeOutput } from './node-output'
import { NodeOverview } from './node-overview'
import { durationMs, isAwaitingApproval, selectNode } from './node-panel-model'
import type { CSSProperties, KeyboardEvent } from 'react'
import type { SelectedNode } from './node-panel-model'
import type { NodePanelTab } from '@/stores/conductor-ui-store'
import type { WorkflowSseEvent } from '@/screens/workflows/use-workflow-events'
import type { WorkflowRunRow } from '@/screens/workflows/api-client'
import { nodeColor } from '@/screens/workflows/node-colors'
import { statusTone } from '@/screens/workflows/run-inspector/inspector-model'
import {
  EVENT_CHIPS,
  filterEvents,
  mergeEvents,
} from '@/screens/workflows/run-inspector/events-model'
import {
  useRunEvents,
  useWorkflowFeatures,
  useWorkflowParsed,
  useWorkflowRun,
} from '@/screens/workflows/use-workflows'

/** What the tabs share (loaded once by the shell). */
export interface NodePanelData {
  runId: string
  nodeId: string
  sel: SelectedNode
  run: WorkflowRunRow | null
  features: Array<string>
  now: number
  type: string
  stage: string
  tone: ReturnType<typeof statusTone>
  durationMs: number | null
  /** Reply given at an upstream approval gate (the input this node acted on). */
  inputReply: string | null
}

const TABS: Array<{ id: NodePanelTab; label: string }> = [
  { id: 'overview', label: 'OVERVIEW' },
  { id: 'output', label: 'OUTPUT' },
  { id: 'events', label: 'EVENTS' },
]

const ALL_CHIPS = new Set(EVENT_CHIPS)

export interface NodePanelProps {
  runId: string
  nodeId: string
  tab: NodePanelTab
  onTab: (tab: NodePanelTab) => void
  onClose: () => void
  onSelectNode: (nodeId: string) => void
  /** ALL NODE RUNS: open the run inspector's NODE RUNS tab on this node. */
  onAllNodeRuns: (nodeId: string) => void
  /** Live SSE events for this run (from ConductorLiveContext). */
  events: Array<WorkflowSseEvent>
  /** Resume a failed run from `fromNodeId`; the button stays disabled until this and `retry_run` exist. */
  onResume?: (runId: string, fromNodeId?: string) => void
  /** A resume request is in flight. */
  resuming?: boolean
}

export function NodePanel({
  runId,
  nodeId,
  tab,
  onTab,
  onClose,
  onSelectNode,
  onAllNodeRuns,
  events,
  onResume,
  resuming = false,
}: NodePanelProps) {
  const runQ = useWorkflowRun(runId)
  const parsedQ = useWorkflowParsed(runQ.data?.run.workflow_id ?? null)
  const featuresQ = useWorkflowFeatures()
  const features = featuresQ.data?.features ?? []
  const nodeRuns = runQ.data?.nodeRuns
  const parsed = parsedQ.data?.parsed ?? null
  const sel = useMemo(
    () => selectNode(parsed, nodeRuns ?? [], nodeId),
    [parsed, nodeRuns, nodeId],
  )
  const pageAll = features.includes('events_query')
  // With events_query the server filters by node_run_id; loops span several
  // node_runs (and skips have none), so those still filter client-side.
  const nodeRunId =
    pageAll && sel.nodeRun && sel.iterations.length === 0
      ? sel.nodeRun.id
      : undefined
  const eventsQ = useRunEvents(
    runId,
    { limit: 1000, node_run_id: nodeRunId },
    { pageAll, enabled: !featuresQ.isLoading },
  )
  const { dag } = useRunDag(runId)
  const ref = useRef<HTMLElement>(null)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const items = useMemo(
    () =>
      filterEvents(
        mergeEvents(
          eventsQ.data?.events ?? [],
          events,
          nodeRuns ?? [],
          runQ.data?.phaseTransitions ?? [],
        ),
        { node: nodeId, chips: ALL_CHIPS, search: '' },
      ),
    [eventsQ.data, events, nodeRuns, runQ.data, nodeId],
  )

  const run = runQ.data?.run ?? null
  const nr = sel.nodeRun
  const awaiting = isAwaitingApproval(nr, run)
  const live = nr?.status === 'running' || awaiting
  const now = useNow(live)
  const dagNode = dag?.nodes.find((n) => n.id === nodeId)
  const type = nr?.node_type ?? sel.def?.type ?? dagNode?.type ?? 'node'
  const status = nr?.status ?? 'not reached'
  const tone = statusTone(status)

  // Focus moves into the panel on open; Esc (anywhere, unless a modal or the
  // fullscreen canvas owns it) closes and the parent restores focus to the node.
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [nodeId])
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('[aria-modal="true"], .dag-wrap.full')) return
      // Esc in a text field (the approval reply) belongs to the field.
      if (
        e.target instanceof Element &&
        e.target.closest(
          'input, textarea, select, [contenteditable=""], [contenteditable="true"]',
        )
      )
        return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const data: NodePanelData = {
    runId,
    nodeId,
    sel,
    run,
    features,
    now,
    type,
    stage: dagNode?.stage ?? '—',
    tone,
    durationMs: durationMs(nr, now),
    inputReply:
      (nodeRuns ?? []).find(
        (r) => sel.dependsOn.includes(r.dag_node_id) && r.approval_response,
      )?.approval_response ?? null,
  }

  const onTabKey = (e: KeyboardEvent, i: number) => {
    const n = TABS.length
    const next =
      e.key === 'ArrowRight'
        ? (i + 1) % n
        : e.key === 'ArrowLeft'
          ? (i - 1 + n) % n
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? n - 1
              : -1
    if (next < 0) return
    e.preventDefault()
    onTab(TABS[next].id)
    tabRefs.current[next]?.focus()
  }

  const dot = nodeColor(type)
  return (
    <section
      ref={ref}
      className="cnp"
      aria-label="Node detail"
      tabIndex={-1}
      data-variant={
        awaiting ? 'approval' : status === 'failed' ? 'failed' : 'default'
      }
    >
      <div className="cnp-h">
        <span className="cnp-tc" style={{ '--node-c': dot } as CSSProperties}>
          {type.toUpperCase()}
        </span>
        <span className="cnp-nt" title={nodeId}>
          {nodeId}
        </span>
        <span className={`cnp-chip ${tone}`}>
          {awaiting ? '⏸ WAITING' : status.toUpperCase()}
        </span>
        <span className="cnp-grow" />
        <button
          type="button"
          className="cnp-ib"
          onClick={onClose}
          aria-label="Close node panel"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div className="cnp-sub">
        {sel.index != null && `node ${sel.index} of ${sel.total} · `}
        {nr && `node_run ${nr.id.slice(0, 8)} · `}run {runId.slice(0, 8)}
      </div>
      <div className="cnp-tabs" role="tablist" aria-label="Node sections">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el
            }}
            type="button"
            role="tab"
            id={`cnp-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="cnp-body"
            tabIndex={tab === t.id ? 0 : -1}
            className={`cnp-tab${tab === t.id ? ' on' : ''}`}
            onClick={() => onTab(t.id)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {t.label}
            {t.id === 'events' && <span className="cnp-n">{items.length}</span>}
          </button>
        ))}
      </div>
      <div
        className="cnp-body"
        id="cnp-body"
        role="tabpanel"
        aria-labelledby={`cnp-tab-${tab}`}
      >
        {runQ.isLoading ? (
          <div className="cnp-empty">Loading node…</div>
        ) : (
          <>
            {tab === 'overview' && (
              <NodeOverview
                d={data}
                onSelectNode={onSelectNode}
                onOpenOutput={() => onTab('output')}
              />
            )}
            {tab === 'output' && (
              <NodeOutput
                d={data}
                onAllNodeRuns={() => onAllNodeRuns(nodeId)}
                onResume={onResume}
                resuming={resuming}
              />
            )}
            {tab === 'events' && <NodeEvents items={items} />}
          </>
        )}
      </div>
    </section>
  )
}
