import { useEffect, useState } from 'react'
import { fmtDuration, nodeProgress } from './dag-layout'
import { useRunDag } from './use-run-dag'
import {
  useAbortMission,
  useConductorMissions,
  useResumeRun,
} from './use-conductor-queries'
import type { StagePill } from './dag-model'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { toast } from '@/components/ui/toast'
import { RESUMABLE, toEpochMs } from '@/screens/workflows/run-status'
import { useRunDefinition } from '@/screens/workflows/run-definition-client'
import { useWorkflowFeatures } from '@/screens/workflows/use-workflows'
import { useConductorUIStore } from '@/stores/conductor-ui-store'

const PILL_CLASS: Record<StagePill['status'], string> = {
  done: 'done',
  running: 'now',
  waiting: 'now wait',
  failed: 'fail',
  pending: '',
}

export function StagePills({ stages }: { stages: Array<StagePill> }) {
  return (
    <div className="stages" role="list" aria-label="Stages">
      {stages.map((s) => (
        <span
          key={s.stage}
          role="listitem"
          className={`st ${PILL_CLASS[s.status]}`}
          title={`${s.nodeIds.length} node(s) · ${s.status}`}
        >
          {s.stage}
          {s.status === 'done' && <span aria-hidden="true"> ✓</span>}
          {s.status === 'failed' && <span aria-hidden="true"> ✗</span>}
        </span>
      ))}
    </div>
  )
}

const ACTIVE = new Set(['running', 'pending', 'paused'])

function triggerOf(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  const t = metadata?.trigger as { kind?: string; type?: string } | undefined
  return t?.kind ?? t?.type ?? null
}

export function NowPlayingStrip({ runId }: { runId: string }) {
  const { run, dag } = useRunDag(runId)
  const { data: missions = [] } = useConductorMissions()
  const mission = missions.find((m) => m.id === runId)
  const setDrawerRunId = useConductorUIStore((s) => s.setDrawerRunId)
  const setSelectedRunId = useConductorUIStore((s) => s.setSelectedRunId)
  const abort = useAbortMission()
  const resumeRun = useResumeRun()
  const features = useWorkflowFeatures().data?.features ?? []
  const pinnedQ = useRunDefinition(
    runId,
    features.includes('definition_pin') && !!run?.definition_checksum,
  )
  const pinned = pinnedQ.data?.available ? pinnedQ.data.definition : null
  const defChanged =
    pinned?.pinned === true &&
    pinned.current_checksum != null &&
    pinned.current_checksum !== pinned.checksum
  const [confirmOpen, setConfirmOpen] = useState(false)

  const active = run ? ACTIVE.has(run.status) : false
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])

  const started = toEpochMs(run?.started_at)
  const ended = toEpochMs(run?.completed_at)
  const elapsed =
    started != null
      ? fmtDuration((active ? now : (ended ?? now)) - started)
      : (mission?.elapsed ?? '—')

  const title = mission?.title ?? run?.workflow_id ?? runId.slice(0, 8)
  const trigger = mission?.triggerKind ?? triggerOf(run?.metadata)
  const progress = dag ? nodeProgress(dag) : null
  const failed = run?.status === 'failed'
  const terminal = !active && run != null
  const canResume =
    features.includes('retry_run') && RESUMABLE.has(run?.status ?? '')
  const attempt = (run?.retry_epoch ?? 0) + 1
  const statusChip =
    run?.status === 'paused'
      ? '⏸ waiting · approval'
      : failed
        ? '✗ failed'
        : active
          ? 'running'
          : (run?.status ?? 'loading')
  const startedClock =
    started != null
      ? new Date(started).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        })
      : null

  return (
    <div className={`now ${run?.status ?? ''}`}>
      <div className="stamp">
        {terminal ? 'total' : 'elapsed'}
        <b>{elapsed}</b>
      </div>
      <div className="body">
        <div className="lbl">
          <span className="chip-status">{statusChip}</span>
          run {runId.slice(0, 8)}
          {attempt > 1 && ` · attempt ${attempt}`}
        </div>
        <div className="prompt">{title}</div>
        <div className="sub-line">
          {run?.workflow_id ?? runId}
          {startedClock && ` · started ${startedClock}`}
          {progress && progress.y > 0 && (
            <>
              {failed ? ' · stopped at node ' : ' · node '}
              {progress.x} of {progress.y}
            </>
          )}
        </div>
        <div className="meta">
          {trigger && <span className="chip-trg">{trigger}</span>}
          {run?.parent_run_id && (
            <>
              {' '}
              · re-run of{' '}
              <button
                type="button"
                className="now-link"
                onClick={() => setSelectedRunId(run.parent_run_id!)}
              >
                {run.parent_run_id.slice(0, 8)}
              </button>
            </>
          )}
          {defChanged && (
            <span
              className="now-warn"
              title={`Pinned ${pinned.checksum?.slice(0, 12)}, current ${pinned.current_checksum?.slice(0, 12)}`}
            >
              {' '}
              · definition changed since run
            </span>
          )}
          {mission && (
            <>
              {' '}
              · used <b>{mission.tokens}</b>
            </>
          )}
        </div>
      </div>
      {dag ? <StagePills stages={dag.stages} /> : <div className="stages" />}
      <div className="controls">
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setDrawerRunId(runId)}
        >
          inspect
        </button>
        {canResume && (
          <button
            type="button"
            className="btn-ghost"
            disabled={resumeRun.isPending}
            title="Re-run the failed nodes and what follows; completed nodes are kept"
            onClick={() => resumeRun.resume(runId)}
          >
            {resumeRun.isPending ? 'resuming…' : 'resume'}
          </button>
        )}
        {active && (
          <button
            type="button"
            className="btn-kill"
            disabled={abort.isPending}
            onClick={() => setConfirmOpen(true)}
          >
            cancel
          </button>
        )}
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="Cancel this run?"
        message={`${title} (${runId.slice(0, 8)}) will be stopped.`}
        confirmLabel="Cancel run"
        cancelLabel="Keep running"
        destructive
        busy={abort.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() =>
          abort.mutate(runId, {
            onSuccess: () => setConfirmOpen(false),
            onError: (e) =>
              toast(e instanceof Error ? e.message : 'Cancel failed', {
                type: 'error',
              }),
          })
        }
      />
    </div>
  )
}
