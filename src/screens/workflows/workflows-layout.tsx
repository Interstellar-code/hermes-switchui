import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWorkflowDefinitions } from './use-workflows'
import { WorkflowsTopBar } from './workflows-top-bar'
import { WorkflowLibrary } from './workflow-library'
import { WorkflowGraphEditor } from './graph-editor/graph-editor'
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
  // F4: while the graph editor is open, it registers a dirty-leave guard.
  const graphLeaveGuardRef = useRef<(() => boolean) | null>(null)

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
  // Bumped by the grid's CLEAR ALL FILTERS; the library resets on change.
  const [clearFiltersKey, setClearFiltersKey] = useState(0)

  // Read ?wf=<id> (OPEN IN EDITOR), ?wizard=<id> and ?run=<id> on mount —
  // and again on popstate so the browser Back button restores the view.
  // Registered once: selection changes never re-read the URL. This is the
  // only Back/Forward guard for a dirty graph editor (its router blocker
  // skips popstate), so a Back press confirms exactly once.
  useEffect(() => {
    let undoingPop = false
    function readUrlParams() {
      const params = new URLSearchParams(window.location.search)
      setSelectedWorkflowId(params.get('wf'))
      setWizardOpenForId(params.get('wizard'))
      setActiveRunId(params.get('run'))
      if (!params.get('wf')) setIsEditingGraph(false)
    }
    function onPopState() {
      if (undoingPop) {
        undoingPop = false
        return
      }
      const guard = graphLeaveGuardRef.current
      if (guard && !guard()) {
        // Cancelled: step forward again — the exact URL (wf/wizard/run) returns.
        undoingPop = true
        window.history.go(1)
        return
      }
      readUrlParams()
    }
    readUrlParams()
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
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

  // F4: in-app navigation away from a dirty graph editor goes through its guard
  // (confirm-discard); non-editing navigation is untouched.
  const leaveGraphEditor = useCallback((navigate: () => void) => {
    const guard = graphLeaveGuardRef.current
    if (guard && !guard()) return
    setIsEditingGraph(false)
    navigate()
  }, [])

  return (
    <>
      <div
        className={`wf-body${selectedWorkflowId ? '' : ' wf-body--browse'}${railCollapsed ? ' wf-body--rail-collapsed' : ''}`}
      >
        <aside className={`wf-library${railCollapsed ? ' is-collapsed' : ''}`}>
          <WorkflowLibrary
            selectedId={selectedWorkflowId}
            onSelectWorkflow={(id) =>
              leaveGraphEditor(() => {
                setSelectedWorkflowId(id)
                const url = new URL(window.location.href)
                url.searchParams.set('wf', id)
                window.history.pushState(null, '', url.toString())
              })
            }
            onClearSelection={() =>
              leaveGraphEditor(() => {
                setSelectedWorkflowId(null)
                const url = new URL(window.location.href)
                url.searchParams.delete('wf')
                window.history.pushState(null, '', url.toString())
              })
            }
            collapsed={railCollapsed}
            onToggleCollapse={() => setRailCollapsed((c) => !c)}
            onFilteredChange={handleFilteredChange}
            workflows={workflows}
            clearKey={clearFiltersKey}
          />
        </aside>
        <main
          className={`wf-editor${activeRunId ? ' wf-editor--with-run' : ''}`}
        >
          <WorkflowsTopBar
            workflows={workflows}
            templateCount={workflows.length}
            engineDown={Boolean(workflowsError)}
            onRefresh={() => void refetchWorkflows()}
          />
          <div className="wf-editor-content">
            {selectedWorkflowId ? (
              isEditingGraph ? (
                <WorkflowGraphEditor
                  workflowId={selectedWorkflowId}
                  onExit={() => setIsEditingGraph(false)}
                  onRegisterGuard={(guard) => {
                    graphLeaveGuardRef.current = guard
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
                onEdit={(id) => {
                  setSelectedWorkflowId(id)
                  setIsEditingGraph(true)
                  const url = new URL(window.location.href)
                  url.searchParams.set('wf', id)
                  window.history.pushState(null, '', url.toString())
                }}
                onOpenLaunchWizard={handleOpenLaunchWizard}
                loadError={workflowsError?.message ?? null}
                onRetry={() => void refetchWorkflows()}
                onClearFilters={() => setClearFiltersKey((k) => k + 1)}
                subgraphCount={
                  workflows.filter((w) => w.kind === 'subgraph').length
                }
                hasAnyWorkflows={workflows.length > 0}
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
