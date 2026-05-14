import { useCallback, useEffect, useState } from 'react'
import { MOCK_WORKFLOWS, type MockWorkflow } from './mock-workflows'
import { WorkflowsTopBar } from './workflows-top-bar'
import { WorkflowLibrary } from './workflow-library'
import { WorkflowActions } from './workflow-actions'
import { WorkflowEditor } from './workflow-editor'
import { WorkflowGrid } from './workflow-grid'
import { LaunchWizard } from './launch-wizard'

export function WorkflowsLayout() {
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null)
  const [wizardOpenForId, setWizardOpenForId] = useState<string | null>(null)
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [filteredWorkflows, setFilteredWorkflows] = useState<MockWorkflow[]>(MOCK_WORKFLOWS)

  // Auto-open wizard when ?wizard=<id> query param present
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const id = params.get('wizard')
    if (id) setWizardOpenForId(id)
  }, [])

  function handleOpenLaunchWizard(workflowId: string) {
    setWizardOpenForId(workflowId)
  }

  const handleFilteredChange = useCallback((workflows: MockWorkflow[]) => {
    setFilteredWorkflows(workflows)
  }, [])

  return (
    <>
      <WorkflowsTopBar />
      <div className="wf-body">
        <aside className={`wf-library${railCollapsed ? ' is-collapsed' : ''}`}>
          <WorkflowLibrary
            selectedId={selectedWorkflowId}
            onSelectWorkflow={setSelectedWorkflowId}
            collapsed={railCollapsed}
            onToggleCollapse={() => setRailCollapsed((c) => !c)}
            onFilteredChange={handleFilteredChange}
          />
        </aside>
        <main className="wf-editor">
          {selectedWorkflowId ? (
            <WorkflowEditor selectedId={selectedWorkflowId} />
          ) : (
            <WorkflowGrid
              workflows={filteredWorkflows}
              onSelect={setSelectedWorkflowId}
            />
          )}
        </main>
        <aside className="wf-actions">
          <WorkflowActions
            selectedId={selectedWorkflowId}
            onOpenLaunchWizard={handleOpenLaunchWizard}
          />
        </aside>
      </div>
      <LaunchWizard workflowId={wizardOpenForId} onClose={() => setWizardOpenForId(null)} />
    </>
  )
}
