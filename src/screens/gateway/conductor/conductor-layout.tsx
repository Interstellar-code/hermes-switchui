import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { LaunchDialog } from '../../workflows/launch-wizard'
import { ApprovalBanner } from './approval-banner'
import { ConductorLiveContext } from './conductor-live-context'
import { ConductorIdle } from './conductor-idle'
import { ConductorTopBar } from './conductor-top-bar'
import { MissionCanvas } from './mission-canvas'
import { MissionDetailDrawer } from './mission-detail-drawer'
import { MissionRail } from './mission-rail'
import { MissionTimeline } from './mission-timeline'
import { NowPlayingStrip } from './now-playing-strip'
import { selectFocus } from './focus'
import { NodePanel } from './node-panel/node-panel'
import { useConductorLive } from './use-conductor-live'
import { useRunDag } from './use-run-dag'
import {
  useConductorMissions,
  useConductorScheduled,
} from './use-conductor-queries'
import { useConductorUIStore } from '@/stores/conductor-ui-store'

export function ConductorLayout() {
  const [launch, setLaunch] = useState<{ open: boolean; workflowId?: string }>({
    open: false,
  })
  const queryClient = useQueryClient()
  const selectedRunId = useConductorUIStore((s) => s.selectedRunId)
  const setSelectedRunId = useConductorUIStore((s) => s.setSelectedRunId)
  const { data: missions = [] } = useConductorMissions()
  const { data: sched } = useConductorScheduled()

  // ?run=<id> deep link selects that run on the canvas.
  const search: Record<string, unknown> = useSearch({ strict: false })
  const runParam = search.run
  const navigate = useNavigate()
  useEffect(() => {
    if (runParam != null && runParam !== '') setSelectedRunId(String(runParam))
  }, [runParam, setSelectedRunId])

  // Reflect selection back into ?run= (only when it differs, so no loop).
  useEffect(() => {
    const current =
      runParam == null || runParam === '' ? null : String(runParam)
    if (selectedRunId === current) return
    // An unset selection with a ?run= still pending is the deep link above landing.
    if (selectedRunId == null && current != null) return
    void navigate({
      to: '/conductor',
      // `run` is not in the route's typed search; the reducer is untyped on purpose.
      search: ((s: Record<string, unknown>) => ({
        ...s,
        run: selectedRunId ?? undefined,
      })) as never,
      replace: true,
    })
  }, [selectedRunId, runParam, navigate])

  // Preview only when the scheduler is alive; otherwise the idle view says "offline".
  const nextScheduled = sched?.schedulerAlive
    ? (sched.scheduled
        .filter((s) => s.enabled && s.nextRunAt != null)
        .sort((a, b) => a.nextRunAt! - b.nextRunAt!)[0] ?? null)
    : null
  const focus = selectFocus({ selectedRunId, missions, nextScheduled })

  // The one per-run EventSource; the node panel and the drawer read it from context.
  const focusRunId = focus.kind === 'run' ? focus.runId : null
  const live = useConductorLive(focusRunId)
  const liveValue = useMemo(
    () => ({ runId: focusRunId, events: live.events, status: live.status }),
    [focusRunId, live.events, live.status],
  )

  // Docked node panel: selection lives in the store, mirrored to ?node=.
  const selectedNodeId = useConductorUIStore((s) => s.selectedNodeId)
  const nodePanelTab = useConductorUIStore((s) => s.nodePanelTab)
  const selectNode = useConductorUIStore((s) => s.selectNode)
  const setNodePanelTab = useConductorUIStore((s) => s.setNodePanelTab)
  const openInspector = useConductorUIStore((s) => s.openInspector)
  const { dag } = useRunDag(focusRunId)
  const nodeParam = search.node
  useEffect(() => {
    if (nodeParam != null && nodeParam !== '') selectNode(String(nodeParam))
  }, [nodeParam, selectNode])
  const prevNode = useRef(selectedNodeId)
  useEffect(() => {
    if (prevNode.current === selectedNodeId) return
    prevNode.current = selectedNodeId
    void navigate({
      to: '/conductor',
      search: ((s: Record<string, unknown>) => ({
        ...s,
        node: selectedNodeId ?? undefined,
      })) as never,
      replace: true,
    })
  }, [selectedNodeId, navigate])
  // The auto-focused run can change without a selection; the panel follows the run.
  const prevRun = useRef(focusRunId)
  useEffect(() => {
    if (prevRun.current !== focusRunId && prevRun.current != null)
      selectNode(null)
    prevRun.current = focusRunId
  }, [focusRunId, selectNode])
  const panelNode =
    focusRunId &&
    selectedNodeId &&
    dag?.nodes.some((n) => n.id === selectedNodeId)
      ? selectedNodeId
      : null

  // Centre only once the panel has docked: the canvas resizes after the commit.
  const [centreId, setCentreId] = useState<string | null>(null)
  useEffect(() => {
    if (!panelNode) {
      setCentreId(null)
      return
    }
    const t = setTimeout(() => setCentreId(panelNode), 150)
    return () => clearTimeout(t)
  }, [panelNode])

  function selectFromCanvas(id: string) {
    const node = dag?.nodes.find((n) => n.id === id)
    selectNode(id, node?.status === 'failed' ? 'output' : 'overview')
  }
  function closePanel() {
    const id = selectedNodeId
    selectNode(null)
    // Focus returns to the node on the canvas (React Flow wrapper carries data-id).
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(
          `.react-flow__node[data-id="${CSS.escape(id ?? '')}"]`,
        )
        ?.focus(),
    )
  }

  // A launch selects the new run on the canvas; the drawer stays closed.
  function handleRunLaunched(runId: string) {
    void queryClient.invalidateQueries({ queryKey: ['conductor'] })
    setSelectedRunId(runId)
    setLaunch({ open: false })
  }

  return (
    <ConductorLiveContext.Provider value={liveValue}>
      <ConductorTopBar />
      <div className="cnd-body">
        <main className="cnd-main">
          <ApprovalBanner />
          {focus.kind === 'run' ? (
            <>
              <NowPlayingStrip runId={focus.runId} />
              <div
                className={`cnd-stage${panelNode ? ' cnd-stage--docked' : ''}`}
              >
                <div className="cnd-stage-main">
                  <MissionCanvas
                    runId={focus.runId}
                    onNodeSelect={selectFromCanvas}
                    focusNodeId={centreId}
                  />
                  <MissionTimeline runId={focus.runId} />
                </div>
                {panelNode && (
                  <NodePanel
                    key={panelNode}
                    runId={focus.runId}
                    nodeId={panelNode}
                    tab={nodePanelTab}
                    onTab={setNodePanelTab}
                    onClose={closePanel}
                    onSelectNode={(id) => selectNode(id)}
                    onAllNodeRuns={(id) =>
                      openInspector(focus.runId, {
                        tab: 'nodes',
                        expandedNodeId: id,
                      })
                    }
                    events={live.events}
                  />
                )}
              </div>
            </>
          ) : (
            <ConductorIdle
              focus={focus}
              nextScheduled={nextScheduled}
              onRunNow={(workflowId) => setLaunch({ open: true, workflowId })}
              onNewMission={() => setLaunch({ open: true })}
            />
          )}
        </main>
        <MissionRail onNewMission={() => setLaunch({ open: true })} />
      </div>
      <MissionDetailDrawer />

      <LaunchDialog
        open={launch.open}
        initialWorkflowId={launch.workflowId}
        onClose={() => setLaunch({ open: false })}
        onRunLaunched={handleRunLaunched}
      />
    </ConductorLiveContext.Provider>
  )
}
