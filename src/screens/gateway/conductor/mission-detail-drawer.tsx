import { useRef, useState } from 'react'
import { useAbortMission } from './use-conductor-queries'
import { useRunDag } from './use-run-dag'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { toast } from '@/components/ui/toast'
import { useFocusTrap } from '@/components/ui/use-focus-trap'
import { useConductorUIStore } from '@/stores/conductor-ui-store'
import { RunDetailPanel } from '@/screens/workflows/run-detail-panel'

const badgeTone = (status: string) =>
  status === 'running' || status === 'pending'
    ? 'live'
    : status === 'completed'
      ? 'done'
      : status === 'failed' || status === 'cancelled'
        ? 'err'
        : ''

export function MissionDetailDrawer() {
  const drawerRunId = useConductorUIStore((s) => s.drawerRunId)
  const setDrawerRunId = useConductorUIStore((s) => s.setDrawerRunId)

  const panelRef = useRef<HTMLElement>(null)
  const close = () => setDrawerRunId(null)

  useFocusTrap(!!drawerRunId, panelRef, close)
  const { run } = useRunDag(drawerRunId)
  const abort = useAbortMission()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const cancellable =
    run != null && ['running', 'pending', 'paused'].includes(run.status)

  if (!drawerRunId) return null

  return (
    <div className="mdd-backdrop">
      <aside
        ref={panelRef}
        className="mdd"
        role="dialog"
        aria-modal="true"
        aria-label="Mission detail"
        tabIndex={-1}
      >
        <div className="mdd-head">
          <span className="mdd-title">
            Mission detail · {drawerRunId.slice(0, 8)}
          </span>
          {run && (
            <span className={`mdd-badge ${badgeTone(run.status)}`}>
              {run.status}
            </span>
          )}
          {cancellable && (
            <button
              type="button"
              className="btn-kill"
              disabled={abort.isPending}
              onClick={() => setConfirmOpen(true)}
            >
              cancel
            </button>
          )}
          <button
            type="button"
            className="mdd-close"
            onClick={close}
            aria-label="Close mission detail"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <RunDetailPanel runId={drawerRunId} onClose={close} hideHeader />
      </aside>
      <ConfirmDialog
        open={confirmOpen}
        title="Cancel this run?"
        message={`Run ${drawerRunId.slice(0, 8)} will be stopped.`}
        confirmLabel="Cancel run"
        cancelLabel="Keep running"
        destructive
        busy={abort.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() =>
          abort.mutate(drawerRunId, {
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
