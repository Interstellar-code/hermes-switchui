import { useEffect, useMemo, useRef, useState } from 'react'
import { NewWorkflowWizard } from './new-workflow-wizard'
import { nodeColor } from './node-colors'
import { isWithin7Days } from './workflows-top-bar'
import { isScheduledYaml } from './schedule'
import type { NodeType, WorkflowSummary } from './types'

export type OriginFilter = 'all' | 'bundled' | 'user' | 'project'
export type StateFilter = 'any' | 'edited7d'

const DISPLAY_NODE_TYPES: ReadonlyArray<NodeType> = [
  'prompt',
  'bash',
  'script',
  'command',
  'loop',
  'approval',
  'cancel',
  'router',
]

function detectNodeTypes(workflow: WorkflowSummary): Set<string> {
  if (workflow.node_types && workflow.node_types.length > 0) {
    return new Set(workflow.node_types)
  }
  const yaml = workflow.yaml || ''
  const found = new Set<string>()
  const matcher =
    /^\s+(prompt|bash|command|approval|router|loop|cancel|script):/gm
  for (const match of yaml.matchAll(matcher)) {
    found.add(match[1])
  }
  if (found.size === 0) {
    found.add('prompt')
  }
  return found
}

function isScheduled(workflow: WorkflowSummary): boolean {
  return isScheduledYaml(workflow.yaml || '')
}

function hasInputs(workflow: WorkflowSummary): boolean {
  return workflow.required_inputs.length + workflow.optional_inputs.length > 0
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
  workflows: Array<WorkflowSummary>
  /** Bumped by the grid's CLEAR ALL FILTERS; resets every filter. */
  clearKey?: number
}

export function WorkflowLibrary({
  selectedId,
  onSelectWorkflow,
  onClearSelection,
  collapsed,
  onToggleCollapse,
  onFilteredChange,
  workflows,
  clearKey = 0,
}: WorkflowLibraryProps) {
  const [search, setSearch] = useState('')
  const [originFilter, setOriginFilter] = useState<OriginFilter>('all')
  const [nodeTypeFilter, setNodeTypeFilter] = useState<string | null>(null)
  const [hasApprovalFilter, setHasApprovalFilter] = useState(false)
  const [scheduledFilter, setScheduledFilter] = useState(false)
  const [hasInputsFilter, setHasInputsFilter] = useState(false)
  const [showSubgraphs, setShowSubgraphs] = useState(false)
  const [stateFilter, setStateFilter] = useState<StateFilter>('any')

  // Modal for new/imported workflow
  const [modalOpen, setModalOpen] = useState(false)
  const [modalInitialYaml, setModalInitialYaml] = useState<string | undefined>(
    undefined,
  )
  const [modalInitialId, setModalInitialId] = useState<string | undefined>(
    undefined,
  )
  const fileInputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Keyboard shortcut '/' focuses search — plain key only: no modifiers,
  // no typing context (inputs / contentEditable), no open dialog on top.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const activeEl = document.activeElement
      if (
        activeEl instanceof HTMLElement &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(activeEl.tagName) ||
          activeEl.isContentEditable)
      ) {
        return
      }
      if (document.querySelector('dialog[open], [role="dialog"]')) return
      e.preventDefault()
      searchInputRef.current?.focus()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    if (clearKey === 0) return
    setSearch('')
    setOriginFilter('all')
    setNodeTypeFilter(null)
    setHasApprovalFilter(false)
    setScheduledFilter(false)
    setHasInputsFilter(false)
    setShowSubgraphs(false)
    setStateFilter('any')
  }, [clearKey])

  // Origin counts
  const originCounts = useMemo(() => {
    const counts = { all: workflows.length, bundled: 0, user: 0, project: 0 }
    for (const w of workflows) {
      if (w.source === 'user') counts.user++
      else if (w.source === 'project') counts.project++
      else counts.bundled++
    }
    return counts
  }, [workflows])

  // Node type counts across all workflows
  const nodeTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const t of DISPLAY_NODE_TYPES) {
      counts[t] = 0
    }
    for (const w of workflows) {
      const types = detectNodeTypes(w)
      for (const t of types) {
        counts[t] = (counts[t] || 0) + 1
      }
    }
    return counts
  }, [workflows])

  // Shape counts
  const shapeCounts = useMemo(() => {
    let approval = 0
    let cron = 0
    let inputs = 0
    let subgraphs = 0
    for (const w of workflows) {
      if (w.has_approval) approval++
      if (isScheduled(w)) cron++
      if (hasInputs(w)) inputs++
      if (w.kind === 'subgraph') subgraphs++
    }
    return { approval, cron, inputs, subgraphs }
  }, [workflows])

  // State counts (validity needs a per-definition validate call — no batch
  // API — so the Valid / YAML-error segments are not offered).
  const stateCounts = useMemo(() => {
    let edited7d = 0
    for (const w of workflows) {
      if (isWithin7Days(w.updated_at ?? w.created_at)) {
        edited7d++
      }
    }
    return {
      any: workflows.length,
      edited7d,
    }
  }, [workflows])

  // Filtered workflows computation
  const filtered = useMemo<Array<WorkflowSummary>>(() => {
    const q = search.trim().toLowerCase()
    return workflows.filter((w) => {
      // Subgraphs handling
      if (w.kind === 'subgraph') {
        if (!showSubgraphs) return false
        if (q) {
          const matchName = w.name.toLowerCase().includes(q)
          const matchId = w.id.toLowerCase().includes(q)
          const matchDesc = w.description.toLowerCase().includes(q)
          if (!matchName && !matchId && !matchDesc) return false
        }
        return true
      }

      // Origin filter
      if (originFilter !== 'all' && w.source !== originFilter) return false

      // Node type filter
      if (nodeTypeFilter && !detectNodeTypes(w).has(nodeTypeFilter)) {
        return false
      }

      // Shape filters
      if (hasApprovalFilter && !w.has_approval) return false
      if (scheduledFilter && !isScheduled(w)) return false
      if (hasInputsFilter && !hasInputs(w)) return false

      // State filter
      if (
        stateFilter === 'edited7d' &&
        !isWithin7Days(w.updated_at ?? w.created_at)
      ) {
        return false
      }

      // Search query filter
      if (q) {
        const matchName = w.name.toLowerCase().includes(q)
        const matchId = w.id.toLowerCase().includes(q)
        const matchDesc = w.description.toLowerCase().includes(q)
        const matchTags = w.tags.some((t) => t.toLowerCase().includes(q))
        if (!matchName && !matchId && !matchDesc && !matchTags) return false
      }

      return true
    })
  }, [
    workflows,
    search,
    originFilter,
    nodeTypeFilter,
    hasApprovalFilter,
    scheduledFilter,
    hasInputsFilter,
    showSubgraphs,
    stateFilter,
  ])

  useEffect(() => {
    onFilteredChange?.(filtered)
  }, [filtered, onFilteredChange])

  useEffect(() => {
    if (!selectedId) return
    const selectedStillVisible = filtered.some((w) => w.id === selectedId)
    if (!selectedStillVisible) {
      onClearSelection?.()
    }
  }, [filtered, onClearSelection, selectedId])

  function handleClearAll() {
    setSearch('')
    setOriginFilter('all')
    setNodeTypeFilter(null)
    setHasApprovalFilter(false)
    setScheduledFilter(false)
    setHasInputsFilter(false)
    setShowSubgraphs(false)
    setStateFilter('any')
    onClearSelection?.()
  }

  const hasActiveFilters =
    Boolean(search) ||
    originFilter !== 'all' ||
    Boolean(nodeTypeFilter) ||
    hasApprovalFilter ||
    scheduledFilter ||
    hasInputsFilter ||
    showSubgraphs ||
    stateFilter !== 'any'

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
    e.target.value = ''
  }

  if (collapsed) {
    return (
      <aside
        className="crail wfr-panel--collapsed"
        aria-label="Workflow filters (collapsed)"
      >
        <button
          type="button"
          className="ib"
          aria-label="Expand filters"
          aria-expanded="false"
          onClick={onToggleCollapse}
          title="Expand filters"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5L14 14" />
          </svg>
        </button>
        <span>FILTERS · {hasActiveFilters ? 'ACTIVE' : 'NONE'}</span>
      </aside>
    )
  }

  return (
    <aside className="rail wf-rail" aria-label="Workflow filters">
      <div className="rh">
        <h2 className="rt">FILTERS</h2>
        <span className="grow" />
        {hasActiveFilters && (
          <button
            type="button"
            className="btn sm gh"
            onClick={handleClearAll}
            title="Clear all filters"
          >
            CLEAR
          </button>
        )}
        <button
          type="button"
          className="ib"
          style={{ width: '22px', height: '22px', marginLeft: '4px' }}
          aria-label="Collapse filters"
          title="Collapse filters"
          onClick={onToggleCollapse}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M11 2L5 8l6 6" />
          </svg>
        </button>
      </div>

      <label className="srch">
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5L14 14" />
        </svg>
        <span className="sr">Search workflows</span>
        <input
          ref={searchInputRef}
          type="search"
          placeholder="Search name, id, trigger…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            onClearSelection?.()
          }}
        />
        <kbd>/</kbd>
      </label>

      {/* ORIGIN */}
      <div className="rs">
        <fieldset>
          <legend>ORIGIN</legend>
          <div className="seg">
            <button
              type="button"
              className="opt"
              aria-pressed={originFilter === 'all'}
              onClick={() => {
                setOriginFilter('all')
                onClearSelection?.()
              }}
            >
              All<span className="n">{originCounts.all}</span>
            </button>
            <button
              type="button"
              className="opt"
              aria-pressed={originFilter === 'bundled'}
              onClick={() => {
                setOriginFilter('bundled')
                onClearSelection?.()
              }}
            >
              Factory<span className="n">{originCounts.bundled}</span>
            </button>
            <button
              type="button"
              className="opt"
              aria-pressed={originFilter === 'user'}
              onClick={() => {
                setOriginFilter('user')
                onClearSelection?.()
              }}
            >
              User<span className="n">{originCounts.user}</span>
            </button>
            <button
              type="button"
              className="opt"
              aria-pressed={originFilter === 'project'}
              onClick={() => {
                setOriginFilter('project')
                onClearSelection?.()
              }}
            >
              Project<span className="n">{originCounts.project}</span>
            </button>
          </div>
        </fieldset>
      </div>

      {/* CONTAINS NODE TYPE */}
      <div className="rs">
        <fieldset>
          <legend>CONTAINS NODE TYPE</legend>
          <div className="tcs">
            {DISPLAY_NODE_TYPES.map((type) => {
              const count = nodeTypeCounts[type] || 0
              const isSelected = nodeTypeFilter === type
              const color = nodeColor(type)
              return (
                <button
                  key={type}
                  type="button"
                  className="tchip"
                  style={{ '--c': color } as React.CSSProperties}
                  aria-pressed={isSelected}
                  disabled={count === 0}
                  onClick={() => {
                    setNodeTypeFilter(isSelected ? null : type)
                    onClearSelection?.()
                  }}
                >
                  <i />
                  {type}
                  <span className="n">{count}</span>
                </button>
              )
            })}
          </div>
        </fieldset>
      </div>

      {/* SHAPE */}
      <div className="rs">
        <fieldset>
          <legend>SHAPE</legend>
          <label className="ck">
            <input
              type="checkbox"
              checked={hasApprovalFilter}
              onChange={(e) => {
                setHasApprovalFilter(e.target.checked)
                onClearSelection?.()
              }}
            />
            Has approval gate<span className="n">{shapeCounts.approval}</span>
          </label>
          <label className="ck">
            <input
              type="checkbox"
              checked={scheduledFilter}
              onChange={(e) => {
                setScheduledFilter(e.target.checked)
                onClearSelection?.()
              }}
            />
            Scheduled (cron)<span className="n">{shapeCounts.cron}</span>
          </label>
          <label className="ck">
            <input
              type="checkbox"
              checked={hasInputsFilter}
              onChange={(e) => {
                setHasInputsFilter(e.target.checked)
                onClearSelection?.()
              }}
            />
            Takes inputs<span className="n">{shapeCounts.inputs}</span>
          </label>
          <label className="ck">
            <input
              type="checkbox"
              checked={showSubgraphs}
              onChange={(e) => {
                setShowSubgraphs(e.target.checked)
                onClearSelection?.()
              }}
            />
            Show subgraphs<span className="n">{shapeCounts.subgraphs}</span>
          </label>
        </fieldset>
      </div>

      {/* STATE */}
      <div className="rs">
        <fieldset>
          <legend>STATE</legend>
          <div className="seg">
            <button
              type="button"
              className="opt"
              aria-pressed={stateFilter === 'any'}
              onClick={() => {
                setStateFilter('any')
                onClearSelection?.()
              }}
            >
              Any<span className="n">{stateCounts.any}</span>
            </button>
            <button
              type="button"
              className="opt"
              aria-pressed={stateFilter === 'edited7d'}
              onClick={() => {
                setStateFilter('edited7d')
                onClearSelection?.()
              }}
            >
              Edited 7d<span className="n">{stateCounts.edited7d}</span>
            </button>
          </div>
        </fieldset>
      </div>

      <div className="rf">
        <input
          ref={fileInputRef}
          type="file"
          accept=".yaml,.yml"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        <button
          type="button"
          className="btn gh"
          onClick={handleImport}
          title="Import workflow from YAML file"
        >
          IMPORT YAML
        </button>
        <button
          type="button"
          className="btn p"
          onClick={handleNew}
          title="Create a new workflow"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <path d="M8 3v10M3 8h10" />
          </svg>
          NEW WORKFLOW
        </button>
      </div>

      {modalOpen && (
        <NewWorkflowWizard
          initialYaml={modalInitialYaml}
          initialId={modalInitialId}
          onClose={() => setModalOpen(false)}
          onOpenWorkflow={onSelectWorkflow}
        />
      )}
    </aside>
  )
}
