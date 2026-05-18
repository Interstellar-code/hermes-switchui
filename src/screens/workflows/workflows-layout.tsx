import { useCallback, useEffect, useMemo, useState } from 'react'
import { useWorkflowDefinitions } from './use-workflows'
import { WorkflowsTopBar } from './workflows-top-bar'
import { WorkflowLibrary } from './workflow-library'
import { WorkflowEditor } from './workflow-editor'
import { WorkflowGrid } from './workflow-grid'
import { LaunchWizard } from './launch-wizard'
import { RunDetailPanel } from './run-detail-panel'
import type { WorkflowSummary } from './types'

export function WorkflowsLayout() {
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(
    null,
  )
  const [wizardOpenForId, setWizardOpenForId] = useState<string | null>(null)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [railCollapsed, setRailCollapsed] = useState(false)

  // B.4: Library + Grid consume live data from /api/workflow-definitions.
  // B.4 Path B: Editor + Launch Wizard now load via useWorkflowParsed (parsed endpoint).
  const { data: liveWorkflows } = useWorkflowDefinitions()
  const workflows = useMemo<Array<WorkflowSummary>>(() => {
    return liveWorkflows ?? []
  }, [liveWorkflows])

  const [filteredWorkflows, setFilteredWorkflows] =
    useState<Array<WorkflowSummary>>(workflows)

  // Read ?wizard=<id> and ?run=<id> query params on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const wizardId = params.get('wizard')
    if (wizardId) setWizardOpenForId(wizardId)
    const runId = params.get('run')
    if (runId) setActiveRunId(runId)
  }, [])

  function handleOpenLaunchWizard(workflowId: string) {
    setWizardOpenForId(workflowId)
  }

  function handleOpenRunPanel(runId: string) {
    setActiveRunId(runId)
    const url = new URL(window.location.href)
    url.searchParams.set('run', runId)
    window.history.pushState(null, '', url.toString())
  }

  function handleCloseRunPanel() {
    setActiveRunId(null)
    const url = new URL(window.location.href)
    url.searchParams.delete('run')
    window.history.pushState(null, '', url.toString())
  }

  const handleFilteredChange = useCallback(
    (nextWorkflows: Array<WorkflowSummary>) => {
      setFilteredWorkflows(nextWorkflows)
    },
    [],
  )

  return (
    <>
      <div
        className={`wf-body${selectedWorkflowId ? '' : ' wf-body--browse'}${railCollapsed ? ' wf-body--rail-collapsed' : ''}`}
      >
        <aside className={`wf-library${railCollapsed ? ' is-collapsed' : ''}`}>
          <WorkflowLibrary
            selectedId={selectedWorkflowId}
            onSelectWorkflow={setSelectedWorkflowId}
            onClearSelection={() => setSelectedWorkflowId(null)}
            collapsed={railCollapsed}
            onToggleCollapse={() => setRailCollapsed((c) => !c)}
            onFilteredChange={handleFilteredChange}
            workflows={workflows}
          />
        </aside>
        <main className={`wf-editor${activeRunId ? ' wf-editor--with-run' : ''}`}>
          <WorkflowsTopBar templateCount={workflows.length} />
          <div className="wf-editor-content">
            {selectedWorkflowId ? (
              <WorkflowEditor
                selectedId={selectedWorkflowId}
                onOpenRun={handleOpenRunPanel}
                onOpenLaunchWizard={handleOpenLaunchWizard}
                onDeselect={() => setSelectedWorkflowId(null)}
                onSelectWorkflow={setSelectedWorkflowId}
              />
            ) : (
              <WorkflowGrid
                workflows={filteredWorkflows}
                onSelect={setSelectedWorkflowId}
              />
            )}
          </div>
          {activeRunId && (
            <div className="wf-run-panel">
              <RunDetailPanel runId={activeRunId} onClose={handleCloseRunPanel} />
            </div>
          )}
        </main>
      </div>
      <LaunchWizard
        workflowId={wizardOpenForId}
        onClose={() => setWizardOpenForId(null)}
        onRunLaunched={handleOpenRunPanel}
      />
    </>
  )
}
