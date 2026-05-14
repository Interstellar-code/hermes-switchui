import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { type WorkflowSummary } from './types'

const ORIGIN_OPTIONS = [
  { value: 'all', label: 'All origins' },
  { value: 'bundled', label: 'Built-in' },
  { value: 'user', label: 'User' },
  { value: 'project', label: 'Project' },
] as const

type OriginFilter = 'all' | 'bundled' | 'user' | 'project'

export interface WorkflowLibraryProps {
  selectedId: string | null
  onSelectWorkflow: (id: string) => void
  collapsed: boolean
  onToggleCollapse: () => void
  onFilteredChange?: (workflows: WorkflowSummary[]) => void
  /** B.4: live workflow definitions (adapted from /api/workflow-definitions). */
  workflows: WorkflowSummary[]
}

export function WorkflowLibrary({
  selectedId: _selectedId,
  onSelectWorkflow: _onSelectWorkflow,
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
  }, [])

  const filtered = useMemo<WorkflowSummary[]>(() => {
    return workflows.filter((w) => {
      if (originFilter !== 'all' && w.source !== originFilter) return false
      if (normalizedSearch) {
        if (
          !w.name.toLowerCase().includes(normalizedSearch) &&
          !w.description.toLowerCase().includes(normalizedSearch)
        )
          return false
      }
      return true
    })
  }, [originFilter, normalizedSearch])

  useEffect(() => {
    onFilteredChange?.(filtered)
  }, [filtered, onFilteredChange])

  function handleNew() {
    console.log('[WorkflowLibrary] + New Workflow clicked')
  }

  function handleImport() {
    console.log('[WorkflowLibrary] Import YAML clicked')
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
        <span className="wfr-collapsed-label">Workflows</span>
      </div>
    )
  }

  return (
    <div className="wfr-panel">
      {/* ── Rail header ─────────────────────────────────── */}
      <div className="wfr-header">
        <h2>Workflows</h2>
        <span className="wfr-ct">{TOTAL}</span>
        <button
          type="button"
          className="wfr-collapse-btn"
          title="Collapse rail"
          aria-label="Collapse rail"
          onClick={onToggleCollapse}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      </div>

      {/* ── CTA buttons ─────────────────────────────────── */}
      <div className="wfr-ctas">
        <button className="wfr-btn-import" onClick={handleImport}>
          Import YAML
        </button>
        <button className="wfr-btn-new" onClick={handleNew}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New
        </button>
      </div>

      {/* ── Search ──────────────────────────────────────── */}
      <div className="wfr-search-wrap">
        <svg className="wfr-search-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="13" height="13">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          className="wfr-search"
          type="text"
          placeholder="Search workflows…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search workflows"
        />
        {search && (
          <button className="wfr-search-clear" onClick={() => setSearch('')} aria-label="Clear search">
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
                className={`wfr-row${originFilter === opt.value ? ' active' : ''}`}
                onClick={() => setOriginFilter(opt.value as OriginFilter)}
              >
                <span>{opt.label}</span>
                <span className="wfr-row-ct">{originCounts[opt.value] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>

      </div>{/* end wfr-body */}
    </div>
  )
}

