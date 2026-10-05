/**
 * RunInspector — tabbed run detail (OVERVIEW · OUTPUT · NODE RUNS · EVENTS ·
 * DEFINITION), shared by Conductor's Inspect drawer and the /workflows run panel.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import '../run-inspector.css'
import '../run-inspector-tabs.css'
import {
  useRunEvents,
  useWorkflowFeatures,
  useWorkflowParsed,
  useWorkflowRun,
} from '../use-workflows'
import { useWorkflowEvents } from '../use-workflow-events'
import { OverviewTab } from './overview-tab'
import { NodeRunsTab } from './node-runs-tab'
import { EventsTab } from './events-tab'
import { OutputTab } from './output-tab'
import { DefinitionTab } from './definition-tab'
import { mergeEvents, skipReasonsFrom } from './events-model'
import { nodeTableRows } from './inspector-model'
import type { WorkflowSseEvent } from '../use-workflow-events'
import type { InspectTab, InspectorCtx } from './inspector-model'
import type { KeyboardEvent, ReactNode } from 'react'

export interface RunInspectorProps {
  runId: string
  /** Live events from the host's own stream; absent = the inspector opens one. */
  events?: Array<WorkflowSseEvent>
  /** Shown only when passed. */
  onOpenNode?: InspectorCtx['onOpenNode']
  /** "re-run of" link target; plain text when absent. */
  onOpenRun?: InspectorCtx['onOpenRun']
  initialTab?: InspectTab
  onTabChange?: (tab: InspectTab) => void
  expandedNodeId?: string | null
  onExpandedChange?: (id: string | null) => void
  /** Rendered below CONTEXT on Overview (AgentsPanel). */
  extraOverview?: ReactNode
}

const TABS: Array<{ id: InspectTab; label: string }> = [
  { id: 'overview', label: 'OVERVIEW' },
  { id: 'output', label: 'OUTPUT' },
  { id: 'nodes', label: 'NODE RUNS' },
  { id: 'events', label: 'EVENTS' },
  { id: 'definition', label: 'DEFINITION' },
]

export function RunInspector({
  runId,
  events,
  onOpenNode,
  onOpenRun,
  initialTab = 'overview',
  onTabChange,
  expandedNodeId = null,
  onExpandedChange,
  extraOverview,
}: RunInspectorProps) {
  const [tab, setTab] = useState<InspectTab>(initialTab)
  const [expanded, setExpanded] = useState<string | null>(expandedNodeId)
  const [eventsNode, setEventsNode] = useState<string | null>(null)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => setTab(initialTab), [initialTab])
  useEffect(() => setExpanded(expandedNodeId), [expandedNodeId])

  const runQ = useWorkflowRun(runId)
  const parsedQ = useWorkflowParsed(runQ.data?.run.workflow_id ?? null)
  const featuresQ = useWorkflowFeatures()
  const pageAll = featuresQ.data?.features.includes('events_query') ?? false
  const eventsQ = useRunEvents(
    runId,
    { limit: 1000 },
    { pageAll, enabled: !featuresQ.isLoading },
  )
  const own = useWorkflowEvents(events ? null : runId)
  const live = events ?? own.events
  const streamStatus = events ? 'open' : own.status

  const nodeRuns = runQ.data?.nodeRuns
  const transitions = runQ.data?.phaseTransitions
  const eventItems = useMemo(
    () =>
      mergeEvents(
        eventsQ.data?.events ?? [],
        live,
        nodeRuns ?? [],
        transitions ?? [],
      ),
    [eventsQ.data, live, nodeRuns, transitions],
  )
  const parsed = parsedQ.data?.parsed ?? null
  const nodeCount = useMemo(
    () =>
      nodeTableRows(parsed, nodeRuns ?? [], skipReasonsFrom(eventItems)).length,
    [parsed, nodeRuns, eventItems],
  )

  if (runQ.isLoading) return <div className="wfri-state">Loading run…</div>
  if (runQ.isError || !runQ.data)
    return (
      <div className="wfri-state wfri-state--err">
        Failed to load run {runId.slice(0, 8)}
        <button
          type="button"
          className="wfri-btn"
          onClick={() => void runQ.refetch()}
        >
          RETRY
        </button>
      </div>
    )

  const ctx: InspectorCtx = {
    runId,
    run: runQ.data.run,
    nodeRuns: runQ.data.nodeRuns,
    phaseTransitions: runQ.data.phaseTransitions,
    parsed,
    features: featuresQ.data?.features ?? [],
    onOpenNode,
    onOpenRun,
  }

  const select = (t: InspectTab) => {
    setTab(t)
    onTabChange?.(t)
  }
  const onKey = (e: KeyboardEvent, i: number) => {
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
    select(TABS[next].id)
    tabRefs.current[next]?.focus()
  }

  return (
    <div className="wfri">
      <div className="wfri-tabs" role="tablist" aria-label="Inspector sections">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el
            }}
            type="button"
            role="tab"
            id={`wfri-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="wfri-panel"
            tabIndex={tab === t.id ? 0 : -1}
            className={`wfri-tab${tab === t.id ? ' on' : ''}`}
            onClick={() => select(t.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.label}
            {t.id === 'nodes' && (
              <span className="wfri-tab-n">{nodeCount}</span>
            )}
          </button>
        ))}
      </div>
      <div
        className="wfri-body"
        role="tabpanel"
        id="wfri-panel"
        aria-labelledby={`wfri-tab-${tab}`}
      >
        {tab === 'overview' && <OverviewTab ctx={ctx} extra={extraOverview} />}
        {tab === 'output' && <OutputTab ctx={ctx} />}
        {tab === 'nodes' && (
          <NodeRunsTab
            ctx={ctx}
            skipReasons={skipReasonsFrom(eventItems)}
            expandedId={expanded}
            onExpand={(id) => {
              setExpanded(id)
              onExpandedChange?.(id)
            }}
            onViewEvents={(id) => {
              setEventsNode(id)
              select('events')
            }}
          />
        )}
        {tab === 'events' && (
          <EventsTab
            ctx={ctx}
            items={eventItems}
            historyNote={
              pageAll
                ? eventsQ.data?.complete === false
                  ? `showing first ${eventsQ.data.events.length} events`
                  : null
                : (eventsQ.data?.events.length ?? 0) >= 1000
                  ? 'showing newest 1000 events · older events may be missing'
                  : 'backend cannot page history · a gap may exist'
            }
            streamStatus={streamStatus}
            nodeFilter={eventsNode}
            onNodeFilter={setEventsNode}
          />
        )}
        {tab === 'definition' && <DefinitionTab ctx={ctx} />}
      </div>
    </div>
  )
}
