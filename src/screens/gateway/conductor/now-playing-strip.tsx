import { useEffect, useState } from 'react'
import { fmtDuration, nodeProgress } from './dag-layout'
import { useRunDag } from './use-run-dag'
import { useAbortMission, useConductorMissions } from './use-conductor-queries'
import type { StagePill } from './dag-model'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { toast } from '@/components/ui/toast'
import { toEpochMs } from '@/screens/workflows/run-status'
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
  const abort = useAbortMission()
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
  const label =
    run?.status === 'paused'
      ? 'needs you'
      : run?.status === 'running' || run?.status === 'pending'
        ? 'now playing'
        : (run?.status ?? 'loading')

  return (
    <div className={`now ${run?.status ?? ''}`}>
      <div className="stamp">
        elapsed
        <b>{elapsed}</b>
      </div>
      <div className="body">
        <div className="lbl">
          {label} · {runId.slice(0, 8)}
        </div>
        <div className="prompt">{title}</div>
        <div className="meta">
          {trigger && <span className="chip-trg">{trigger}</span>}
          {progress && progress.y > 0 && (
            <>
              node <b>{progress.x}</b> of <b>{progress.y}</b>
            </>
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
