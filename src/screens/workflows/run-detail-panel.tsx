/**
 * RunDetailPanel — the /workflows run panel: header + the shared tabbed
 * RunInspector. Opened by the LaunchWizard after a successful launch.
 */
import '@/styles/workflow-ui.css'
import { RunInspector } from './run-inspector/run-inspector'
import { TERMINAL, statusTone } from './run-inspector/inspector-model'
import { useCancelRun, useWorkflowRun } from './use-workflows'

interface Props {
  runId: string
  onClose: () => void
  /** Hide the built-in header (host supplies its own). */
  hideHeader?: boolean
}

export function RunDetailPanel(props: Props) {
  return (
    <div data-wf-ui style={{ display: 'contents' }}>
      <RunDetailPanelInner {...props} />
    </div>
  )
}

function RunDetailPanelInner({ runId, onClose, hideHeader = false }: Props) {
  const { data } = useWorkflowRun(runId)
  const cancelMutation = useCancelRun(runId)
  const run = data?.run

  return (
    <div className="wfrd-panel">
      {!hideHeader && (
        <div className="wfrd-header">
          <div className="wfrd-header-left">
            <span className="wfrd-run-id">run:{runId.slice(0, 8)}</span>
            {run && (
              <>
                <span className={`wfri-chip ${statusTone(run.status)}`}>
                  {run.status}
                </span>
                <span className="wfrd-phase-pill">{run.current_phase}</span>
              </>
            )}
          </div>
          <div className="wfrd-header-right">
            {run && !TERMINAL.has(run.status) && (
              <button
                className="wfrd-btn wfrd-btn--danger"
                disabled={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate()}
              >
                {cancelMutation.isPending ? 'Cancelling…' : 'Cancel run'}
              </button>
            )}
            <button
              className="wfrd-btn wfrd-btn--ghost"
              onClick={onClose}
              aria-label="Close panel"
            >
              ✕
            </button>
          </div>
        </div>
      )}
      <RunInspector runId={runId} />
    </div>
  )
}
