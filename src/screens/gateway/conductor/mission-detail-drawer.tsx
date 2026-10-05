import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AgentsPanel } from './agents-panel'
import { useConductorLiveContext } from './conductor-live-context'
import { useAbortMission } from './use-conductor-queries'
import { useNow } from './flow/use-now'
import { useRunDag } from './use-run-dag'
import type { LaunchWorkflowInput } from '@/screens/workflows/api-client'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { toast } from '@/components/ui/toast'
import { useFocusTrap } from '@/components/ui/use-focus-trap'
import { useConductorUIStore } from '@/stores/conductor-ui-store'
import { RunInspector } from '@/screens/workflows/run-inspector/run-inspector'
import {
  fmtClockDuration,
  statusTone,
  triggerText,
} from '@/screens/workflows/run-inspector/inspector-model'
import { runAgainInput, toEpochMs } from '@/screens/workflows/run-status'
import {
  useLaunchWorkflowRun,
  useWorkflowFeatures,
  useWorkflowParsed,
} from '@/screens/workflows/use-workflows'

export function MissionDetailDrawer() {
  const drawerRunId = useConductorUIStore((s) => s.drawerRunId)
  const setDrawerRunId = useConductorUIStore((s) => s.setDrawerRunId)
  const setSelectedRunId = useConductorUIStore((s) => s.setSelectedRunId)
  const inspectTab = useConductorUIStore((s) => s.inspectTab)
  const setInspectTab = useConductorUIStore((s) => s.setInspectTab)
  const expandedNodeId = useConductorUIStore((s) => s.expandedNodeId)
  const setExpandedNodeId = useConductorUIStore((s) => s.setExpandedNodeId)
  const selectNode = useConductorUIStore((s) => s.selectNode)
  const live = useConductorLiveContext()

  const panelRef = useRef<HTMLElement>(null)
  const close = () => setDrawerRunId(null)

  useFocusTrap(!!drawerRunId, panelRef, close)
  const { run, workflowId } = useRunDag(drawerRunId)
  const parsedQ = useWorkflowParsed(workflowId)
  const featuresQ = useWorkflowFeatures()
  const abort = useAbortMission()
  const launch = useLaunchWorkflowRun()
  const queryClient = useQueryClient()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const cancellable =
    run != null && ['running', 'pending', 'paused'].includes(run.status)
  const now = useNow(!!drawerRunId && cancellable)

  if (!drawerRunId) return null

  const rerun = run ? runAgainInput(run) : null
  const startedMs = toEpochMs(run?.started_at)
  const endMs = toEpochMs(run?.completed_at) ?? (cancellable ? now : Date.now())
  const tone = statusTone(run?.status ?? '')

  function runAgain() {
    if (!run || !rerun) return
    const input: LaunchWorkflowInput = featuresQ.data?.features.includes(
      'parent_run',
    )
      ? ({ ...rerun, parent_run_id: run.id } as LaunchWorkflowInput)
      : rerun
    launch.mutate(input, {
      onSuccess: (r) => {
        void queryClient.invalidateQueries({ queryKey: ['conductor'] })
        setSelectedRunId(r.run.id)
        setDrawerRunId(r.run.id)
      },
      onError: (e) =>
        toast(e instanceof Error ? e.message : 'Run again failed', {
          type: 'error',
        }),
    })
  }

  return (
    <>
      <div className="wfri-backdrop" onClick={close}>
        <aside
          ref={panelRef}
          className="wfri-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Run inspector"
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="wfri-dh">
            <div className="wfri-dh-r">
              <span className="wfri-dt">
                {parsedQ.data?.definition.name ?? workflowId ?? 'Run'}
              </span>
              {run && (
                <>
                  <span className={`wfri-chip ${tone}`}>{run.status}</span>
                  <span className="wfri-chip">{triggerText(run)}</span>
                </>
              )}
              <span className="wfri-grow" />
              <button
                type="button"
                className="wfri-btn"
                disabled={!rerun || launch.isPending}
                title={rerun ? undefined : 'No message recorded for this run'}
                onClick={runAgain}
              >
                RUN AGAIN
              </button>
              <button
                type="button"
                className="wfri-btn"
                disabled={!cancellable || abort.isPending}
                title={cancellable ? undefined : 'Run already finished'}
                onClick={() => setConfirmOpen(true)}
              >
                CANCEL
              </button>
              <button
                type="button"
                className="wfri-ib"
                onClick={close}
                aria-label="Close inspector"
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
            <div className="wfri-dh-meta">
              <span>run {drawerRunId.slice(0, 8)}</span>
              {startedMs != null && (
                <>
                  <span>·</span>
                  <span>elapsed {fmtClockDuration(endMs - startedMs)}</span>
                </>
              )}
              {featuresQ.data?.profile && (
                <>
                  <span>·</span>
                  <span>profile {featuresQ.data.profile}</span>
                </>
              )}
            </div>
          </div>
          <RunInspector
            runId={drawerRunId}
            initialTab={inspectTab}
            onTabChange={setInspectTab}
            expandedNodeId={expandedNodeId}
            onExpandedChange={setExpandedNodeId}
            // The layout's single stream, when it is this run's; otherwise the inspector opens its own.
            events={live.runId === drawerRunId ? live.events : undefined}
            onOpenNode={(id, panelTab) => {
              // Run first: selecting a different run clears the node selection.
              setSelectedRunId(drawerRunId)
              setDrawerRunId(null)
              selectNode(
                { runId: drawerRunId, nodeId: id },
                panelTab ?? 'overview',
              )
            }}
            extraOverview={<AgentsPanel runId={drawerRunId} />}
          />
        </aside>
      </div>
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
    </>
  )
}
