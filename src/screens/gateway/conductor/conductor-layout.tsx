import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { LaunchDialog } from '../../workflows/launch-wizard'
import { ApprovalBanner } from './approval-banner'
import { ConductorIdle } from './conductor-idle'
import { ConductorTopBar } from './conductor-top-bar'
import { MissionCanvas } from './mission-canvas'
import { MissionDetailDrawer } from './mission-detail-drawer'
import { MissionRail } from './mission-rail'
import { MissionTimeline } from './mission-timeline'
import { NowPlayingStrip } from './now-playing-strip'
import { selectFocus } from './focus'
import { useConductorLive } from './use-conductor-live'
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

  // At most one per-run EventSource: the drawer's RunDetailPanel opens its own.
  const drawerRunId = useConductorUIStore((s) => s.drawerRunId)
  useConductorLive(
    drawerRunId ? null : focus.kind === 'run' ? focus.runId : null,
  )

  // A launch selects the new run on the canvas; the drawer stays closed.
  function handleRunLaunched(runId: string) {
    void queryClient.invalidateQueries({ queryKey: ['conductor'] })
    setSelectedRunId(runId)
    setLaunch({ open: false })
  }

  return (
    <>
      <ConductorTopBar />
      <div className="cnd-body">
        <main className="cnd-main">
          <ApprovalBanner />
          {focus.kind === 'run' ? (
            <>
              <NowPlayingStrip runId={focus.runId} />
              <MissionCanvas runId={focus.runId} />
              <MissionTimeline runId={focus.runId} />
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
    </>
  )
}
