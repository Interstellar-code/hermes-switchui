import { useMemo, useState } from 'react'
import { relativeTime, type MockWorkflow } from './mock-workflows'

type SortKey = 'alpha' | 'last-used'

interface WorkflowGridProps {
  workflows: MockWorkflow[]
  onSelect: (id: string) => void
}

export function WorkflowGrid({ workflows, onSelect }: WorkflowGridProps) {
  const [sort, setSort] = useState<SortKey>('alpha')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')

  const sorted = useMemo(() => {
    const copy = [...workflows]
    if (sort === 'alpha') {
      copy.sort((a, b) => a.name.localeCompare(b.name))
    } else {
      copy.sort((a, b) => {
        const ta = a.last_used_at ? new Date(a.last_used_at).getTime() : 0
        const tb = b.last_used_at ? new Date(b.last_used_at).getTime() : 0
        return tb - ta
      })
    }
    return copy
  }, [workflows, sort])

  return (
    <div className="wfg-root">
      {/* ── Toolbar ── */}
      <div className="wfg-toolbar">
        <span className="wfg-count">{workflows.length} results</span>
        <div className="wfg-toolbar-right">
          <select
            className="wfg-sort-select"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Sort workflows"
          >
            <option value="alpha">A → Z</option>
            <option value="last-used">Last used</option>
          </select>
          <div className="wfg-view-toggle" role="group" aria-label="View mode">
            <button
              type="button"
              className={viewMode === 'grid' ? 'active' : ''}
              onClick={() => setViewMode('grid')}
              aria-label="Grid view"
              title="Grid view"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
                <rect x="1" y="1" width="5" height="5" rx="1" />
                <rect x="10" y="1" width="5" height="5" rx="1" />
                <rect x="1" y="10" width="5" height="5" rx="1" />
                <rect x="10" y="10" width="5" height="5" rx="1" />
              </svg>
            </button>
            <button
              type="button"
              className={viewMode === 'list' ? 'active' : ''}
              onClick={() => setViewMode('list')}
              aria-label="List view"
              title="List view"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
                <rect x="1" y="2" width="14" height="2" rx="1" />
                <rect x="1" y="7" width="14" height="2" rx="1" />
                <rect x="1" y="12" width="14" height="2" rx="1" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* ── Cards ── */}
      {sorted.length === 0 ? (
        <div className="wfg-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" width="28" height="28">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <span>No workflows match the current filters.</span>
        </div>
      ) : (
        <div className={`wfg-cards${viewMode === 'list' ? ' wfg-cards--list' : ''}`}>
          {sorted.map((wf) => (
            <GridCard key={wf.id} wf={wf} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  )
}

function GridCard({ wf, onSelect }: { wf: MockWorkflow; onSelect: (id: string) => void }) {
  const srcLabel = wf.source === 'bundled' ? 'built-in' : wf.source
  const srcCls = `wfg-src-badge wfg-src-${wf.source}`

  return (
    <div
      className="wfg-card"
      role="button"
      tabIndex={0}
      onClick={() => onSelect(wf.id)}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(wf.id)}
    >
      <div className="wfg-card-head">
        <span className="wfg-card-name">{wf.name}</span>
        <div className="wfg-card-badges">
          {wf.version_tier === 'v1.1' && <span className="wfg-badge-v11">v1.1</span>}
          <span className={srcCls}>{srcLabel}</span>
        </div>
      </div>
      <p className="wfg-card-desc">{wf.description}</p>
      <div className="wfg-card-tags">
        {wf.tags.map((t) => (
          <span key={t} className="wfg-tag-chip">{t}</span>
        ))}
        {wf.has_loop && <span className="wfg-tag-chip wfg-tag-loop">loop</span>}
        {wf.has_approval && <span className="wfg-tag-chip wfg-tag-approval">approval</span>}
      </div>
      <div className="wfg-card-meta">
        <span className="wfg-meta-nodes">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="10" height="10">
            <circle cx="12" cy="5" r="2" /><circle cx="5" cy="19" r="2" /><circle cx="19" cy="19" r="2" />
            <path d="M12 7v4M12 11l-5 6M12 11l5 6" />
          </svg>
          {wf.node_count} nodes
        </span>
        <span className="wfg-meta-time">{relativeTime(wf.last_used_at)}</span>
      </div>
    </div>
  )
}
