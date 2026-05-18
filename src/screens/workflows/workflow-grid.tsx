import { useMemo, useState } from 'react'
import { relativeTime } from './types'
import type { WorkflowSummary } from './types'

type SortKey = 'alpha' | 'last-used' | 'nodes'
type ViewMode = 'grid' | 'table'

interface WorkflowGridProps {
  workflows: Array<WorkflowSummary>
  onSelect: (id: string) => void
}

export function WorkflowGrid({ workflows, onSelect }: WorkflowGridProps) {
  const [sort, setSort] = useState<SortKey>('alpha')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')

  const sorted = useMemo(() => {
    const copy = [...workflows]
    if (sort === 'alpha') {
      copy.sort((a, b) => a.name.localeCompare(b.name))
    } else if (sort === 'nodes') {
      copy.sort((a, b) => b.node_count - a.node_count)
    } else {
      copy.sort((a, b) => {
        const ta = a.last_used_at ? new Date(a.last_used_at).getTime() : 0
        const tb = b.last_used_at ? new Date(b.last_used_at).getTime() : 0
        return tb - ta
      })
    }
    // Subgraphs always pin to the top so the "Show subgraphs" toggle yields a
    // visible result regardless of the lexical/numeric sort underneath.
    copy.sort((a, b) => {
      const aSub = a.kind === 'subgraph' ? 0 : 1
      const bSub = b.kind === 'subgraph' ? 0 : 1
      return aSub - bSub
    })
    return copy
  }, [workflows, sort])

  function cycleSort() {
    setSort((prev) =>
      prev === 'alpha' ? 'last-used' : prev === 'last-used' ? 'nodes' : 'alpha',
    )
  }

  return (
    <div className="wfg-root">
      <div className="wfg-toolbar">
        <span className="wfg-count">
          {sorted.length} of {workflows.length}
        </span>
        <span className="wfg-grow" />
        <button
          type="button"
          className="wfg-sort"
          onClick={cycleSort}
          aria-label="Cycle workflow sort"
        >
          sort · {sortLabel(sort)}
        </button>
        <div className="wfg-view-toggle" role="tablist" aria-label="View mode">
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
            <span>grid</span>
          </button>
          <button
            type="button"
            className={viewMode === 'table' ? 'active' : ''}
            onClick={() => setViewMode('table')}
            aria-label="Table view"
            title="Table view"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
              <rect x="1" y="2" width="14" height="2" rx="1" />
              <rect x="1" y="7" width="14" height="2" rx="1" />
              <rect x="1" y="12" width="14" height="2" rx="1" />
            </svg>
            <span>table</span>
          </button>
        </div>
      </div>

      <div className="wfg-canvas">
        {sorted.length === 0 ? (
          <div className="wfg-empty">
            <div className="wfg-empty-glyph">∅</div>
            no workflows match.
            <br />
            <span>try changing the search or origin filter.</span>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="wfg-grid">
            {sorted.map((wf) => (
              <WorkflowCard key={wf.id} wf={wf} onSelect={onSelect} />
            ))}
          </div>
        ) : (
          <WorkflowTable workflows={sorted} onSelect={onSelect} />
        )}
      </div>

      <footer className="wfg-foot">
        <span>
          <b>{workflows.length}</b> workflows
        </span>
        <span className="wfg-sep" />
        <span>
          <b>{sorted.length}</b> visible
        </span>
        <span className="wfg-sep" />
        <span>
          mode <b>{viewMode}</b>
        </span>
        <span className="wfg-foot-updated">
          updated <b>now</b>
        </span>
      </footer>
    </div>
  )
}

function sortLabel(sort: SortKey): string {
  if (sort === 'alpha') return 'name a-z'
  if (sort === 'nodes') return 'most nodes'
  return 'recently used'
}

function workflowInitials(name: string): string {
  return name
    .split(/[\s-_]+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function sourceLabel(source: WorkflowSummary['source']): string {
  return source === 'bundled' ? 'built-in' : source
}

function WorkflowCard({
  wf,
  onSelect,
}: {
  wf: WorkflowSummary
  onSelect: (id: string) => void
}) {
  const srcCls = `wfg-src-badge wfg-src-${wf.source}`
  const tagCount =
    wf.tags.length + (wf.has_loop ? 1 : 0) + (wf.has_approval ? 1 : 0)

  return (
    <div
      className="wfg-card"
      role="button"
      tabIndex={0}
      onClick={() => onSelect(wf.id)}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(wf.id)}
    >
      <div className="wfg-card-head">
        <div className="wfg-card-glyph">{workflowInitials(wf.name)}</div>
        <div className="wfg-card-title">
          <div className="wfg-card-name">{wf.name}</div>
          <div className="wfg-card-by">{wf.id}</div>
        </div>
        <div className="wfg-card-right">
          {wf.kind === 'subgraph' ? (
            <span className="wfg-tag wfg-tag-subgraph">SUBGRAPH</span>
          ) : (
            <span className={srcCls}>{sourceLabel(wf.source)}</span>
          )}
        </div>
      </div>
      <div className="wfg-card-desc">{wf.description}</div>
      <div className="wfg-kvgrid">
        <div className="wfg-kv">
          <span className="wfg-lbl">Nodes</span>
          <b>{wf.node_count}</b>
        </div>
        <div className="wfg-kv">
          <span className="wfg-lbl">Inputs</span>
          <b>{wf.required_inputs.length + wf.optional_inputs.length}</b>
        </div>
      </div>
      <div className="wfg-card-tags">
        <span className="wfg-tag wfg-tag-transport">{wf.version_tier}</span>
        {wf.tags.slice(0, 3).map((t) => (
          <span key={t} className="wfg-tag">
            {t}
          </span>
        ))}
        {wf.has_loop && <span className="wfg-tag wfg-tag-loop">loop</span>}
        {wf.has_approval && (
          <span className="wfg-tag wfg-tag-approval">approval</span>
        )}
        {tagCount > 3 && <span className="wfg-tag">+{tagCount - 3}</span>}
      </div>
      <div className="wfg-card-foot">
        <button
          type="button"
          className="wfg-btn-mini"
          onClick={(e) => {
            e.stopPropagation()
            onSelect(wf.id)
          }}
        >
          Inspect
        </button>
        <span className="wfg-meta-time">{relativeTime(wf.last_used_at)}</span>
      </div>
    </div>
  )
}

function WorkflowTable({
  workflows,
  onSelect,
}: {
  workflows: Array<WorkflowSummary>
  onSelect: (id: string) => void
}) {
  return (
    <table className="wfg-table">
      <thead>
        <tr>
          <th>Workflow</th>
          <th>Source</th>
          <th>Version</th>
          <th>Nodes</th>
          <th>Inputs</th>
          <th>Last used</th>
        </tr>
      </thead>
      <tbody>
        {workflows.map((wf) => (
          <tr key={wf.id} onClick={() => onSelect(wf.id)}>
            <td>
              <div className="wfg-table-name">{wf.name}</div>
              <div className="wfg-table-id">{wf.id}</div>
            </td>
            <td>
              <span className={`wfg-src-badge wfg-src-${wf.source}`}>
                {sourceLabel(wf.source)}
              </span>
            </td>
            <td>{wf.version_tier}</td>
            <td>{wf.node_count}</td>
            <td>{wf.required_inputs.length + wf.optional_inputs.length}</td>
            <td>{relativeTime(wf.last_used_at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
