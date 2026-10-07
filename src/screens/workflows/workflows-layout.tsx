import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useWorkflowDefinitions } from './use-workflows'
import { WorkflowsTopBar } from './workflows-top-bar'
import { WorkflowLibrary } from './workflow-library'
import { WorkflowGraphEditor } from './graph-editor/graph-editor'
import { WorkflowGrid } from './workflow-grid'
import { WorkflowDetail } from './workflow-detail'
import { LaunchWizard } from './launch-wizard'
import { RunDetailPanel } from './run-detail-panel'
import type { WorkflowSummary } from './types'

const searchStr = (v: unknown): string | null =>
  v == null || v === '' ? null : String(v)

export function WorkflowsLayout() {
  // ?wf= / ?wizard= / ?run= are the view state (OPEN IN EDITOR, deep links,
  // Back/Forward). All writes go through the router, so the graph editor's
  // useBlocker is the one guard for every navigation away from a dirty draft.
  const search: Record<string, unknown> = useSearch({ strict: false })
  const navigate = useNavigate()
  const selectedWorkflowId = searchStr(search.wf)
  const wizardOpenForId = searchStr(search.wizard)
  const activeRunId = searchStr(search.run)
  function setSearch(
    patch: Record<string, string | undefined>,
    replace = false,
  ) {
    void navigate({
      to: '/workflows',
      // wf/wizard/run are not in the route's typed search.
      search: ((s: Record<string, unknown>) => ({ ...s, ...patch })) as never,
      replace,
    })
  }

  // EDIT GRAPH has no URL of its own: the editor is open while this matches ?wf=.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingFor, setEditingFor] = useState(selectedWorkflowId)
  if (editingFor !== selectedWorkflowId) {
    setEditingFor(selectedWorkflowId)
    if (editingId !== selectedWorkflowId) setEditingId(null)
  }
  const isEditingGraph = editingId !== null && editingId === selectedWorkflowId
  const [railCollapsed, setRailCollapsed] = useState(false)
  const effectiveRailCollapsed = isEditingGraph || railCollapsed

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

  const handleFilteredChange = useCallback(
    (nextWorkflows: Array<WorkflowSummary>) => {
      setFilteredWorkflows(nextWorkflows)
    },
    [],
  )

  return (
    <>
      <div
        className={`wf-body${selectedWorkflowId ? '' : ' wf-body--browse'}${effectiveRailCollapsed ? ' wf-body--rail-collapsed' : ''}`}
      >
        <aside
          className={`wf-library${effectiveRailCollapsed ? ' is-collapsed' : ''}`}
        >
          <WorkflowLibrary
            selectedId={selectedWorkflowId}
            onSelectWorkflow={(id) => setSearch({ wf: id })}
            onClearSelection={() => setSearch({ wf: undefined })}
            collapsed={effectiveRailCollapsed}
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
                  onExit={() => setEditingId(null)}
                />
              ) : (
                <WorkflowDetail
                  workflowId={selectedWorkflowId}
                  onBack={() => setSearch({ wf: undefined })}
                  onEditGraph={() => setEditingId(selectedWorkflowId)}
                  onOpenLaunchWizard={(id) => setSearch({ wizard: id }, true)}
                  onSelectWorkflow={(id) => setSearch({ wf: id })}
                />
              )
            ) : (
              <WorkflowGrid
                workflows={filteredWorkflows}
                onSelect={(id) => setSearch({ wf: id })}
                onEdit={(id) => {
                  setEditingId(id)
                  setSearch({ wf: id })
                }}
                onOpenLaunchWizard={(id) => setSearch({ wizard: id }, true)}
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
                onClose={() => setSearch({ run: undefined })}
              />
            </div>
          )}
        </main>
      </div>
      <LaunchWizard
        workflowId={wizardOpenForId}
        onClose={() => setSearch({ wizard: undefined }, true)}
        onRunLaunched={(runId) => setSearch({ wizard: undefined, run: runId })}
      />
    </>
  )
}
