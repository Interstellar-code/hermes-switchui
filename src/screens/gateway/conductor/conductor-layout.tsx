import { useState } from 'react'
import { MissionCanvas } from './mission-canvas'
import { MissionRail } from './mission-rail'
import { NowPlayingStrip } from './now-playing-strip'
import { ConductorTopBar } from './conductor-top-bar'
import { WorkerLanes } from './worker-lanes'
import { MissionDetailDrawer } from './mission-detail-drawer'
import { LaunchWizard } from '../../workflows/launch-wizard'
import { useWorkflowDefinitions } from '../../workflows/use-workflows'

export function ConductorLayout() {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [wizardId, setWizardId] = useState<string | null>(null)
  const { data: workflows = [] } = useWorkflowDefinitions()

  function handlePickWorkflow(id: string) {
    setPickerOpen(false)
    setWizardId(id)
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

      {pickerOpen && (
        <div className="wfw-backdrop" onClick={() => setPickerOpen(false)}>
          <div
            className="wfw-shell"
            style={{ maxWidth: 480, maxHeight: '60vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="wfw-head">
              <span className="wfw-title">Select workflow to run</span>
              <button
                className="wfw-close-btn"
                onClick={() => setPickerOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="wfw-body">
              {workflows.length === 0 && (
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
      )}

      <LaunchWizard workflowId={wizardId} onClose={() => setWizardId(null)} />
    </>
  )
}
