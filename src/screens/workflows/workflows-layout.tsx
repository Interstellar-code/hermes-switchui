import { useCallback, useEffect, useMemo, useState } from 'react'
import { useWorkflowDefinitions } from './use-workflows'
import { WorkflowsTopBar } from './workflows-top-bar'
import { WorkflowLibrary } from './workflow-library'
import { WorkflowActions } from './workflow-actions'
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
      <WorkflowsTopBar templateCount={workflows.length} />
      <div className="wf-body">
        <aside className={`wf-library${railCollapsed ? ' is-collapsed' : ''}`}>
          <WorkflowLibrary
            selectedId={selectedWorkflowId}
            onSelectWorkflow={setSelectedWorkflowId}
            collapsed={railCollapsed}
            onToggleCollapse={() => setRailCollapsed((c) => !c)}
            onFilteredChange={handleFilteredChange}
            workflows={workflows}
          />
        </aside>
        <main className="wf-editor">
          {activeRunId ? (
            <RunDetailPanel runId={activeRunId} onClose={handleCloseRunPanel} />
          ) : selectedWorkflowId ? (
            <WorkflowEditor selectedId={selectedWorkflowId} />
          ) : (
            <WorkflowGrid
              workflows={filteredWorkflows}
              onSelect={setSelectedWorkflowId}
            />
          )}
        </main>
        {selectedWorkflowId ? (
          <aside className="wf-actions">
            <WorkflowActions
              selectedId={selectedWorkflowId}
              onOpenLaunchWizard={handleOpenLaunchWizard}
              onDeselect={() => setSelectedWorkflowId(null)}
            />
          </aside>
        ) : null}
      </div>
      <LaunchWizard
        workflowId={wizardOpenForId}
        onClose={() => setWizardOpenForId(null)}
        onRunLaunched={handleOpenRunPanel}
      />
    </>
  )
}
