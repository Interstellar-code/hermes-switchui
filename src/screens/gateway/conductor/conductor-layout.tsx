import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { LaunchWizard } from '../../workflows/launch-wizard'
import { useWorkflowDefinitions } from '../../workflows/use-workflows'
import { MissionCanvas } from './mission-canvas'
import { MissionRail } from './mission-rail'
import { NowPlayingStrip } from './now-playing-strip'
import { ConductorTopBar } from './conductor-top-bar'
import { WorkerLanes } from './worker-lanes'
import { MissionDetailDrawer } from './mission-detail-drawer'
import '@/styles/workflow-ui.css'
import { useFocusTrap } from '@/components/ui/use-focus-trap'
import { useConductorUIStore } from '@/stores/conductor-ui-store'

export function ConductorLayout() {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [wizardId, setWizardId] = useState<string | null>(null)
  const { data: workflows = [], isLoading } = useWorkflowDefinitions()
  const queryClient = useQueryClient()
  const setSelectedRunId = useConductorUIStore((s) => s.setSelectedRunId)

  const pickerRef = useRef<HTMLDivElement>(null)
  useFocusTrap(pickerOpen, pickerRef, () => setPickerOpen(false))

  function handlePickWorkflow(id: string) {
    setPickerOpen(false)
    setWizardId(id)
  }

  // A launch selects the new run on the canvas; the drawer stays closed.
  function handleRunLaunched(runId: string) {
    void queryClient.invalidateQueries({ queryKey: ['conductor'] })
    setSelectedRunId(runId)
  }

  return (
    <>
      <ConductorTopBar />
      <div className="cnd-body">
        <main className="cnd-main">
          <NowPlayingStrip />
          <MissionCanvas />
          <WorkerLanes />
        </main>
        <MissionRail onNewMission={() => setPickerOpen(true)} />
      </div>
      <MissionDetailDrawer />

      {pickerOpen &&
        createPortal(
          <div data-wf-ui>
            <div className="wfw-backdrop" onClick={() => setPickerOpen(false)}>
              <div
                ref={pickerRef}
                className="wfw-modal"
                role="dialog"
                aria-modal="true"
                aria-label="Select workflow to run"
                style={{ maxWidth: 480, maxHeight: '60vh', overflowY: 'auto' }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="wfw-header">
                  <span className="wfw-progress-title">
                    Select workflow to run
                  </span>
                  <button
                    className="wfw-close-btn"
                    onClick={() => setPickerOpen(false)}
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </div>
                <div className="wfw-body">
                  {isLoading && (
                    <p style={{ padding: '1rem', opacity: 0.5 }}>Loading…</p>
                  )}
                  {!isLoading && workflows.length === 0 && (
                    <p style={{ padding: '1rem', opacity: 0.5 }}>
                      No workflows found. Create one on the Workflows page.
                    </p>
                  )}
                  {workflows.map((wf) => (
                    <button
                      key={wf.id}
                      onClick={() => handlePickWorkflow(wf.id)}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '0.6rem 1rem',
                        background: 'none',
                        border: 'none',
                        borderBottom: '1px solid var(--border, #222)',
                        cursor: 'pointer',
                        color: 'inherit',
                        fontSize: '0.85rem',
                      }}
                    >
                      <strong>{wf.name}</strong>
                      <span
                        style={{
                          opacity: 0.5,
                          marginLeft: '0.5rem',
                          fontSize: '0.75rem',
                        }}
                      >
                        {wf.id}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      <LaunchWizard
        workflowId={wizardId}
        onClose={() => setWizardId(null)}
        onRunLaunched={handleRunLaunched}
      />
    </>
  )
}
