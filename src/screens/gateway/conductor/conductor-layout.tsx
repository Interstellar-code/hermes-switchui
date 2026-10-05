import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  useResumeRun,
} from './use-conductor-queries'
import { useConductorUIStore } from '@/stores/conductor-ui-store'

const searchStr = (v: unknown): string | null =>
  v == null || v === '' ? null : String(v)

export function ConductorLayout() {
  const [launch, setLaunch] = useState<{ open: boolean; workflowId?: string }>({
    open: false,
  })
  const queryClient = useQueryClient()
  const selectedRunId = useConductorUIStore((s) => s.selectedRunId)
  const setSelectedRunId = useConductorUIStore((s) => s.setSelectedRunId)
  const { data: missions = [] } = useConductorMissions()
  const { data: sched } = useConductorScheduled()

  const search: Record<string, unknown> = useSearch({ strict: false })
  const navigate = useNavigate()
  const urlRun = searchStr(search.run)
  const urlNode = searchStr(search.node)

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
    () => ({
      runId: focusRunId,
      events: live.events,
      status: live.status,
      subscribeNodeLog: live.subscribeNodeLog,
    }),
    [focusRunId, live.events, live.status, live.subscribeNodeLog],
  )

  // Docked node panel: selection lives in the store stamped with its run.
  const selectedNode = useConductorUIStore((s) => s.selectedNode)
  const nodePanelTab = useConductorUIStore((s) => s.nodePanelTab)
  const selectNode = useConductorUIStore((s) => s.selectNode)
  const setNodePanelTab = useConductorUIStore((s) => s.setNodePanelTab)
  const openInspector = useConductorUIStore((s) => s.openInspector)
  const { dag } = useRunDag(focusRunId)
  const resumeRun = useResumeRun()

  // URL <-> store. A changed URL (deep link, back/forward, our own write
  // landing) is applied first; then the store is reflected in ONE navigate so
  // ?run= and ?node= never race each other.
  const appliedUrl = useRef<string | null>(null)
  useEffect(() => {
    const key = `${urlRun ?? ''}|${urlNode ?? ''}`
    if (appliedUrl.current !== key) {
      // ?node= without ?run= belongs to the auto-focused run: wait for one.
      const nodeRun = urlRun ?? focusRunId
      if (urlNode && !nodeRun) return
      appliedUrl.current = key
      if (urlRun) setSelectedRunId(urlRun)
      if (urlNode && nodeRun) selectNode({ runId: nodeRun, nodeId: urlNode })
    }
    const st = useConductorUIStore.getState()
    const run = st.selectedRunId
    const node =
      st.selectedNode && st.selectedNode.runId === (run ?? focusRunId)
        ? st.selectedNode.nodeId
        : null
    if (run === urlRun && node === urlNode) return
    void navigate({
      to: '/conductor',
      // `run`/`node` are not in the route's typed search; the reducer is untyped on purpose.
      search: ((s: Record<string, unknown>) => ({
        ...s,
        run: run ?? undefined,
        node: node ?? undefined,
      })) as never,
      replace: true,
    })
  }, [
    urlRun,
    urlNode,
    focusRunId,
    selectedRunId,
    selectedNode,
    setSelectedRunId,
    selectNode,
    navigate,
  ])

  // A selection made on another run (auto-focus moved on) is simply not shown.
  const selNodeId =
    focusRunId && selectedNode?.runId === focusRunId
      ? selectedNode.nodeId
      : null
  const panelNode =
    selNodeId && dag?.nodes.some((n) => n.id === selNodeId) ? selNodeId : null
  const hiddenNode = selNodeId && dag && !panelNode ? selNodeId : null

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
    if (!focusRunId) return
    const node = dag?.nodes.find((n) => n.id === id)
    selectNode(
      { runId: focusRunId, nodeId: id },
      node?.status === 'failed' ? 'output' : 'overview',
    )
  }
  // Stable so the panel's Esc listener is not re-bound every render.
  const closePanel = useCallback(() => {
    const id = useConductorUIStore.getState().selectedNode?.nodeId
    selectNode(null)
    if (!id) return
    // Focus returns to the focusable node card on the canvas.
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`)
        ?.focus(),
    )
  }, [selectNode])

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
                  {hiddenNode && (
                    <div className="cnd-node-notice" role="status">
                      Node “{hiddenNode}” is not shown on the canvas.
                      <button type="button" onClick={() => selectNode(null)}>
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>
                {panelNode && (
                  <NodePanel
                    key={panelNode}
                    runId={focus.runId}
                    nodeId={panelNode}
                    tab={nodePanelTab}
                    onTab={setNodePanelTab}
                    onClose={closePanel}
                    onSelectNode={(id) =>
                      selectNode({ runId: focus.runId, nodeId: id })
                    }
                    onAllNodeRuns={(id) =>
                      openInspector(focus.runId, {
                        tab: 'nodes',
                        expandedNodeId: id,
                      })
                    }
                    events={live.events}
                    onResume={resumeRun.resume}
                    resuming={resumeRun.isPending}
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
