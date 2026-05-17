import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { NewWorkflowWizard } from './new-workflow-wizard'
import type { NodeType, WorkflowSummary } from './types'

const ORIGIN_OPTIONS = [
  { value: 'all', label: 'All origins' },
  { value: 'bundled', label: 'Built-in' },
  { value: 'user', label: 'User' },
  { value: 'project', label: 'Project' },
] as const

type OriginFilter = 'all' | 'bundled' | 'user' | 'project'
type NodeTypeFilter = 'all' | NodeType
type TaskFilter = 'all' | 'hermes' | 'local'

const NODE_TYPE_OPTIONS: ReadonlyArray<{
  value: NodeTypeFilter
  label: string
}> = [
  { value: 'all', label: 'All' },
  { value: 'prompt', label: 'prompt' },
  { value: 'command', label: 'command' },
  { value: 'bash', label: 'bash' },
  { value: 'script', label: 'script' },
  { value: 'loop', label: 'loop' },
  { value: 'approval', label: 'approval' },
  { value: 'router', label: 'router' },
  { value: 'cancel', label: 'cancel' },
]

const TASK_OPTIONS: ReadonlyArray<{
  value: TaskFilter
  label: string
}> = [
  { value: 'all', label: 'All' },
  { value: 'hermes', label: 'Hermes tasks' },
  { value: 'local', label: 'Local only' },
]

function detectNodeTypes(workflow: WorkflowSummary): Set<NodeType> {
  const yaml = workflow.yaml
  const found = new Set<NodeType>()
  const matcher =
    /^\s+(prompt|bash|command|approval|router|loop|cancel|script):/gm
  for (const match of yaml.matchAll(matcher)) {
    found.add(match[1] as NodeType)
  }
  if (found.size === 0) {
    found.add('prompt')
  }
  return found
}

function hasHermesTask(workflow: WorkflowSummary): boolean {
  return /^\s+hermes_task:/m.test(workflow.yaml)
}

function slugify(name: string): string {
  return name
    .replace(/\.ya?ml$/i, '')
    .replace(/[^A-Za-z0-9_:.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 128)
}

export interface WorkflowLibraryProps {
  selectedId: string | null
  onSelectWorkflow: (id: string) => void
  onClearSelection?: () => void
  collapsed: boolean
  onToggleCollapse: () => void
  onFilteredChange?: (workflows: Array<WorkflowSummary>) => void
  /** B.4: live workflow definitions (adapted from /api/workflow-definitions). */
  workflows: Array<WorkflowSummary>
}

export function WorkflowLibrary({
  selectedId,
  onSelectWorkflow: _onSelectWorkflow,
  onClearSelection,
  collapsed,
  onToggleCollapse,
  onFilteredChange,
  workflows,
}: WorkflowLibraryProps) {
  const TOTAL = workflows.length
  const [, setSkeleton] = useState(true)
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [originFilter, setOriginFilter] = useState<OriginFilter>('all')
  const [nodeTypeFilter, setNodeTypeFilter] = useState<NodeTypeFilter>('all')
  const [taskFilter, setTaskFilter] = useState<TaskFilter>('all')

  // Modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [modalInitialYaml, setModalInitialYaml] = useState<string | undefined>(
    undefined,
  )
  const [modalInitialId, setModalInitialId] = useState<string | undefined>(
    undefined,
  )
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setTimeout(() => setSkeleton(false), 280)
    return () => clearTimeout(t)
  }, [])

  const normalizedSearch = deferredSearch.trim().toLowerCase()

  // origin counts (unfiltered)
  const originCounts = useMemo(() => {
    const counts: Record<string, number> = { all: TOTAL }
    for (const w of workflows) {
      counts[w.source] = (counts[w.source] || 0) + 1
    }
    return counts
  }, [workflows, TOTAL])

  const nodeTypeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: TOTAL }
    for (const workflow of workflows) {
      const types = detectNodeTypes(workflow)
      for (const type of types) {
        counts[type] = (counts[type] || 0) + 1
      }
    }
    return counts
  }, [workflows, TOTAL])

  const taskCounts = useMemo(() => {
    const counts: Record<TaskFilter, number> = {
      all: TOTAL,
      hermes: 0,
      local: 0,
    }
    for (const workflow of workflows) {
      if (hasHermesTask(workflow)) counts.hermes += 1
      else counts.local += 1
    }
    return counts
  }, [workflows, TOTAL])

  const filtered = useMemo<Array<WorkflowSummary>>(() => {
    return workflows.filter((w) => {
      if (originFilter !== 'all' && w.source !== originFilter) return false
      if (nodeTypeFilter !== 'all' && !detectNodeTypes(w).has(nodeTypeFilter)) {
        return false
      }
      if (taskFilter === 'hermes' && !hasHermesTask(w)) return false
      if (taskFilter === 'local' && hasHermesTask(w)) return false
      if (normalizedSearch) {
        if (
          !w.name.toLowerCase().includes(normalizedSearch) &&
          !w.description.toLowerCase().includes(normalizedSearch)
        )
          return false
      }
      return true
    })
  }, [workflows, originFilter, nodeTypeFilter, taskFilter, normalizedSearch])

  useEffect(() => {
    onFilteredChange?.(filtered)
  }, [filtered, onFilteredChange])

  useEffect(() => {
    if (!selectedId) return
    const selectedStillVisible = filtered.some(
      (workflow) => workflow.id === selectedId,
    )
    if (!selectedStillVisible) {
      onClearSelection?.()
    }
  }, [filtered, onClearSelection, selectedId])

  function handleNew() {
    setModalInitialYaml(undefined)
    setModalInitialId(undefined)
    setModalOpen(true)
  }

  function handleImport() {
    fileInputRef.current?.click()
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    setModalInitialYaml(text)
    setModalInitialId(slugify(file.name))
    setModalOpen(true)
    // Reset so the same file can be re-imported
    e.target.value = ''
  }

  function handleSearchChange(value: string) {
    setSearch(value)
    onClearSelection?.()
  }

  function resetFilters() {
    setSearch('')
    setOriginFilter('all')
    setNodeTypeFilter('all')
    setTaskFilter('all')
    onClearSelection?.()
  }

  function handleOriginClick(next: OriginFilter) {
    setOriginFilter(next)
    onClearSelection?.()
  }

  function handleNodeTypeClick(next: NodeTypeFilter) {
    setNodeTypeFilter(next)
    onClearSelection?.()
  }

  function handleTaskFilterClick(next: TaskFilter) {
    setTaskFilter(next)
    onClearSelection?.()
  }

  if (collapsed) {
    return (
      <div className="wfr-panel wfr-panel--collapsed">
        <button
          type="button"
          className="wfr-expand-btn"
          title="Expand rail"
          aria-label="Expand rail"
          onClick={onToggleCollapse}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            width="14"
            height="14"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
        <span className="wfr-collapsed-label">Workflows</span>
      </div>
    )
  }

  return (
    <>
      {modalOpen && (
        <NewWorkflowWizard
          initialYaml={modalInitialYaml}
          initialId={modalInitialId}
          onClose={() => setModalOpen(false)}
        />
      )}

      {/* Hidden file input for Import YAML */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".yml,.yaml,text/yaml"
        style={{ display: 'none' }}
        onChange={(e) => {
          void handleFileChange(e)
        }}
      />

      <div className="wfr-panel">
        {/* ── Rail header ─────────────────────────────────── */}
        <div className="wfr-header">
          <h2>Filters</h2>
          <span className="wfr-ct">{TOTAL}</span>
          <div className="wfr-actions">
            <button
              type="button"
              className="wfr-icon-btn"
              title="Reset filters"
              aria-label="Reset filters"
              onClick={resetFilters}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                width="14"
                height="14"
              >
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" />
              </svg>
            </button>
            <button
              type="button"
              className="wfr-icon-btn"
              title="Collapse rail"
              aria-label="Collapse rail"
              onClick={onToggleCollapse}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                width="14"
                height="14"
              >
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── CTA buttons ─────────────────────────────────── */}
        <div className="wfr-ctas">
          <button className="wfr-btn-import" onClick={handleImport}>
            Import YAML
          </button>
          <button className="wfr-btn-new" onClick={handleNew}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              width="12"
              height="12"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            New
          </button>
        </div>

        {/* ── Search ──────────────────────────────────────── */}
        <div className="wfr-search-wrap">
          <svg
            className="wfr-search-ico"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            width="13"
            height="13"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            className="wfr-search"
            type="text"
            placeholder="Search workflows…"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            aria-label="Search workflows"
          />
          {search && (
            <button
              className="wfr-search-clear"
              onClick={() => handleSearchChange('')}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>

        {/* ── Filter body ─────────────────────────────────── */}
        <div className="wfr-body">
          {/* ORIGIN section */}
          <div className="wfr-section">
            <div className="wfr-sec-label">Origin</div>
            <div className="wfr-list">
              {ORIGIN_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`wfr-opt-row${originFilter === opt.value ? ' on' : ''}`}
                  onClick={() => handleOriginClick(opt.value as OriginFilter)}
                >
                  <span className="wfr-dot" />
                  <span>{opt.label}</span>
                  <span className="wfr-row-ct">
                    {originCounts[opt.value] ?? 0}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="wfr-section">
            <div className="wfr-sec-label">Node type</div>
            <div className="wfr-list">
              {NODE_TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`wfr-opt-row${nodeTypeFilter === opt.value ? ' on' : ''}`}
                  onClick={() => handleNodeTypeClick(opt.value)}
                >
                  <span className="wfr-dot" />
                  <span>{opt.label}</span>
                  <span className="wfr-row-ct">
                    {nodeTypeCounts[opt.value] ?? 0}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="wfr-section">
            <div className="wfr-sec-label">Tasks</div>
            <div className="wfr-list">
              {TASK_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`wfr-opt-row${taskFilter === opt.value ? ' on' : ''}`}
                  onClick={() => handleTaskFilterClick(opt.value)}
                >
                  <span className="wfr-dot" />
                  <span>{opt.label}</span>
                  <span className="wfr-row-ct">{taskCounts[opt.value]}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="wfr-foot">
          <span>
            <b>{filtered.length}</b> visible
          </span>
          <span className="wfr-foot-sep" />
          <span>
            mode <b>yaml filters</b>
          </span>
        </div>
      </div>
    </>
  )
}
