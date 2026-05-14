import { useCallback, useEffect, useMemo, useState } from 'react'
import { MOCK_WORKFLOWS, type MockWorkflow } from './mock-workflows'
import { useWorkflowDefinitions } from './use-workflows'
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

  // B.4: Library + Grid consume live data from /api/workflow-definitions.
  // Editor + Launch Wizard still consume mock-workflows.ts for the rich
  // DagNode structure (parsed-YAML endpoint will land later).
  const { data: liveWorkflows, isLoading } = useWorkflowDefinitions()
  const workflows = useMemo<MockWorkflow[]>(() => {
    // While loading OR if the engine has no defs yet, fall back to the mock
    // catalog so the page is usable for dev / first-run experience.
    if (isLoading) return MOCK_WORKFLOWS
    if (!liveWorkflows || liveWorkflows.length === 0) return MOCK_WORKFLOWS
    return liveWorkflows
  }, [liveWorkflows, isLoading])

  const [filteredWorkflows, setFilteredWorkflows] = useState<MockWorkflow[]>(workflows)

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
            workflows={workflows}
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
