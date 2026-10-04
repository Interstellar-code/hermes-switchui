import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAbortMission } from './use-conductor-queries'
import type { Mission } from './use-conductor-queries'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useLaunchWorkflowRun } from '@/screens/workflows/use-workflows'
import { useConductorUIStore } from '@/stores/conductor-ui-store'

export type MissionStatus = Mission['status']
export type MissionCardData = Mission

interface MissionCardProps {
  mission: MissionCardData
}

const ACTIVE: ReadonlySet<MissionStatus> = new Set([
  'live',
  'waiting',
  'queued',
])

const actionBtn = {
  background: 'none',
  border: 'none',
  padding: 0,
  marginLeft: 8,
} as const

export function MissionCard({ mission }: MissionCardProps) {
  const { id, title, subtitle, status, elapsed, tokens } = mission

  const selectedRunId = useConductorUIStore((s) => s.selectedRunId)
  const setSelectedRunId = useConductorUIStore((s) => s.setSelectedRunId)
  const setDrawerRunId = useConductorUIStore((s) => s.setDrawerRunId)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const abort = useAbortMission()
  const launch = useLaunchWorkflowRun()
  const queryClient = useQueryClient()

  const canRerun = Boolean(mission.userMessage)

  function rerun(e: React.MouseEvent) {
    e.stopPropagation()
    launch.mutate(
      {
        workflow_id: mission.workflowId,
        conversation_id: crypto.randomUUID(),
        user_message: mission.userMessage,
        variables: Object.keys(mission.inputs).length
          ? mission.inputs
          : undefined,
        schedule: { type: 'now' },
      },
      {
        onSuccess: (r) => {
          void queryClient.invalidateQueries({ queryKey: ['conductor'] })
          setSelectedRunId(r.run.id)
        },
      },
    )
  }

  return (
    <div
      className={`miss ${status}${selectedRunId === id ? ' focus' : ''}`}
      onClick={() => setSelectedRunId(id)}
    >
      <div className="rail" />
      <div className="body">
        <div className="ttl">{title}</div>
        <div className="sub">{subtitle}</div>
        <div className="badges">
          {status === 'waiting' ? (
            <span className="b waiting">needs you</span>
          ) : (
            <span className={`b ${status}`}>{status}</span>
          )}
          <span className="b">{elapsed}</span>
        </div>
      </div>
      <div className="meta">
        <span className="tok">{tokens}</span>
        <br />
        <button
          type="button"
          className="replay"
          style={actionBtn}
          onClick={(e) => {
            e.stopPropagation()
            setDrawerRunId(id)
          }}
        >
          inspect
        </button>
        {ACTIVE.has(status) ? (
          <button
            type="button"
            className="replay"
            style={actionBtn}
            disabled={abort.isPending}
            onClick={(e) => {
              e.stopPropagation()
              setConfirmOpen(true)
            }}
          >
            cancel
          </button>
        ) : (
          <button
            type="button"
            className="replay"
            style={{ ...actionBtn, opacity: canRerun ? 1 : 0.5 }}
            disabled={!canRerun || launch.isPending}
            title={
              canRerun
                ? 'Run again with the same inputs'
                : 'No original message recorded for this run'
            }
            onClick={rerun}
          >
            run again
          </button>
        )}
      </div>
      {/* Portal events bubble through the React tree to `.miss` onClick. */}
      <div onClick={(e) => e.stopPropagation()}>
        <ConfirmDialog
          open={confirmOpen}
          title="Cancel this run?"
          message={`${title} (${id.slice(0, 8)}) will be stopped.`}
          confirmLabel="Cancel run"
          cancelLabel="Keep running"
          destructive
          busy={abort.isPending}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() =>
            abort.mutate(id, { onSettled: () => setConfirmOpen(false) })
          }
        />
      </div>
    </div>
  )
}
