import { useCallback, useEffect, useMemo, useState } from 'react'
import { useWorkflowDefinitions } from './use-workflows'
import { WorkflowsTopBar } from './workflows-top-bar'
import { WorkflowLibrary } from './workflow-library'
import { WorkflowEditor } from './workflow-editor'
import { WorkflowGrid } from './workflow-grid'
import { WorkflowDetail } from './workflow-detail'
import { LaunchWizard } from './launch-wizard'
import { RunDetailPanel } from './run-detail-panel'
import type { WorkflowSummary } from './types'

export function WorkflowsLayout() {
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(
    null,
  )
  const [isEditingGraph, setIsEditingGraph] = useState(false)
  const [wizardOpenForId, setWizardOpenForId] = useState<string | null>(null)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [railCollapsed, setRailCollapsed] = useState(false)

  // B.4: Library + Grid consume live data from /api/workflow-definitions.
  // B.4 Path B: Editor + Launch Wizard now load via useWorkflowParsed (parsed endpoint).
  const {
    data: liveWorkflows,
    error: workflowsError,
    refetch: refetchWorkflows,
  } = useWorkflowDefinitions()
  const workflows = useMemo<Array<WorkflowSummary>>(() => {
    return liveWorkflows ?? []
  }, [liveWorkflows])

  const [filteredWorkflows, setFilteredWorkflows] =
    useState<Array<WorkflowSummary>>(workflows)

  // Read ?wf=<id> (OPEN IN EDITOR), ?wizard=<id> and ?run=<id> on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const wfId = params.get('wf')
    if (wfId) setSelectedWorkflowId(wfId)
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
            onSelectWorkflow={(id) => {
              setSelectedWorkflowId(id)
              setIsEditingGraph(false)
              const url = new URL(window.location.href)
              url.searchParams.set('wf', id)
              window.history.pushState(null, '', url.toString())
            }}
            onClearSelection={() => {
              setSelectedWorkflowId(null)
              setIsEditingGraph(false)
              const url = new URL(window.location.href)
              url.searchParams.delete('wf')
              window.history.pushState(null, '', url.toString())
            }}
            collapsed={railCollapsed}
            onToggleCollapse={() => setRailCollapsed((c) => !c)}
            onFilteredChange={handleFilteredChange}
            workflows={workflows}
          />
        </aside>
        <main
          className={`wf-editor${activeRunId ? ' wf-editor--with-run' : ''}`}
        >
          <WorkflowsTopBar
            workflows={workflows}
            templateCount={workflows.length}
            onRefresh={() => void refetchWorkflows()}
          />
          <div className="wf-editor-content">
            {selectedWorkflowId ? (
              isEditingGraph ? (
                <WorkflowEditor
                  selectedId={selectedWorkflowId}
                  onOpenRun={handleOpenRunPanel}
                  onOpenLaunchWizard={handleOpenLaunchWizard}
                  onDeselect={() => {
                    setSelectedWorkflowId(null)
                    setIsEditingGraph(false)
                    const url = new URL(window.location.href)
                    url.searchParams.delete('wf')
                    window.history.pushState(null, '', url.toString())
                  }}
                  onSelectWorkflow={(id) => {
                    setSelectedWorkflowId(id)
                    const url = new URL(window.location.href)
                    url.searchParams.set('wf', id)
                    window.history.pushState(null, '', url.toString())
                  }}
                />
              ) : (
                <WorkflowDetail
                  workflowId={selectedWorkflowId}
                  onBack={() => {
                    setSelectedWorkflowId(null)
                    setIsEditingGraph(false)
                    const url = new URL(window.location.href)
                    url.searchParams.delete('wf')
                    window.history.pushState(null, '', url.toString())
                  }}
                  onEditGraph={() => setIsEditingGraph(true)}
                  onOpenLaunchWizard={handleOpenLaunchWizard}
                  onSelectWorkflow={(id) => {
                    setSelectedWorkflowId(id)
                    setIsEditingGraph(false)
                    const url = new URL(window.location.href)
                    url.searchParams.set('wf', id)
                    window.history.pushState(null, '', url.toString())
                  }}
                />
              )
            ) : (
              <WorkflowGrid
                workflows={filteredWorkflows}
                onSelect={(id) => {
                  setSelectedWorkflowId(id)
                  setIsEditingGraph(false)
                  const url = new URL(window.location.href)
                  url.searchParams.set('wf', id)
                  window.history.pushState(null, '', url.toString())
                }}
                onOpenLaunchWizard={handleOpenLaunchWizard}
                loadError={workflowsError?.message ?? null}
                onRetry={() => void refetchWorkflows()}
              />
            )}
          </div>
          {activeRunId && (
            <div className="wf-run-panel">
              <RunDetailPanel
                runId={activeRunId}
                onClose={handleCloseRunPanel}
              />
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
