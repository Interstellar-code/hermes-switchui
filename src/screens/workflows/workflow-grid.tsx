import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { NewWorkflowWizard } from './new-workflow-wizard'
import { nodeColor } from './node-colors'
import { isWithin7Days } from './workflows-top-bar'
import { useWorkflowParsed } from './use-workflows'
import { relativeTime } from './types'
import { WorkflowTable } from './workflow-table'
import type { WorkflowSource, WorkflowSummary } from './types'
import { buildDag } from '@/screens/gateway/conductor/dag-model'
import { FlowCanvas } from '@/screens/gateway/conductor/mission-canvas'

export type SortKey = 'recent' | 'alpha' | 'nodes'
export type ViewMode = 'grid' | 'table'

export function cleanDescription(desc: string | null | undefined): string {
  if (!desc) return ''
  return desc
    .replace(/^Use when:\s*/i, '')
    .replace(/^Use when\s+/i, '')
    .trim()
}

export function getNodeTypeStats(workflow: WorkflowSummary): {
  items: Array<{ type: string; count: number; pct: number; color: string }>
  label: string
} {
  const types = workflow.node_types ?? []
  if (types.length === 0) {
    const fallbackCount = workflow.node_count || 1
    return {
      items: [
        {
          type: 'prompt',
          count: fallbackCount,
          pct: 100,
          color: nodeColor('prompt'),
        },
      ],
      label: `${fallbackCount} prompt`,
    }
  }
  const counts: Record<string, number> = {}
  for (const t of types) {
    counts[t] = (counts[t] || 0) + 1
  }
  const total = types.length
  const items = Object.entries(counts).map(([type, count]) => ({
    type,
    count,
    pct: (count / total) * 100,
    color: nodeColor(type),
  }))
  const label = items.map((i) => `${i.count} ${i.type}`).join(', ')
  return { items, label }
}

export function NodeTypeBar({
  workflow,
  width = '200px',
}: {
  workflow: WorkflowSummary
  width?: string
}) {
  const { items, label } = getNodeTypeStats(workflow)
  return (
    <span
      className="tb"
      role="img"
      aria-label={label}
      style={{ width }}
      title={label}
    >
      {items.map((item) => (
        <i
          key={item.type}
          style={{ width: `${item.pct}%`, background: item.color }}
        />
      ))}
    </span>
  )
}

function CardGraphPreview({ workflow }: { workflow: WorkflowSummary }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsVisible(true)
            observer.disconnect()
            break
          }
        }
      },
      { rootMargin: '120px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const { data } = useWorkflowParsed(isVisible ? workflow.id : null)
  const dag = useMemo(() => {
    if (!data?.parsed) return null
    try {
      return buildDag(data.parsed)
    } catch {
      return null
    }
  }, [data])

  return (
    <div
      ref={containerRef}
      className="pv"
      role="img"
      aria-label={`Graph: ${getNodeTypeStats(workflow).label}`}
    >
      {dag && dag.nodes.length > 0 ? (
        <Suspense fallback={<NodeTypeBar workflow={workflow} width="160px" />}>
          <FlowCanvas
            key={workflow.id}
            dag={dag}
            workflowId={workflow.id}
            preview
          />
        </Suspense>
      ) : (
        <NodeTypeBar workflow={workflow} width="160px" />
      )}
    </div>
  )
}

function renderOriginChip(source: WorkflowSource, userModified?: 0 | 1) {
  if (userModified === 1) {
    return (
      <span className="chip cy" style={{ flexShrink: 0 }}>
        MODIFIED
      </span>
    )
  }
  if (source === 'user') {
    return (
      <span className="chip cy" style={{ flexShrink: 0 }}>
        USER
      </span>
    )
  }
  if (source === 'project') {
    return (
      <span className="chip pu" style={{ flexShrink: 0 }}>
        PROJECT
      </span>
    )
  }
  return (
    <span className="chip mu" style={{ flexShrink: 0 }}>
      FACTORY
    </span>
  )
}

function formatInputsSummary(wf: WorkflowSummary): string {
  const total = wf.required_inputs.length + wf.optional_inputs.length
  if (total === 0) return 'no inputs'
  if (wf.required_inputs.length > 0 && wf.optional_inputs.length === 0) {
    return `${total} input`
  }
  if (wf.required_inputs.length === 0 && wf.optional_inputs.length > 0) {
    return `${total} optional input${total > 1 ? 's' : ''}`
  }
  return `${total} input${total > 1 ? 's' : ''}`
}

function formatEditedTime(wf: WorkflowSummary): string {
  const ts = wf.updated_at ?? wf.created_at
  if (!ts) return 'Never'
  return relativeTime(ts)
}

interface WorkflowGridProps {
  workflows: Array<WorkflowSummary>
  onSelect: (id: string) => void
  onOpenLaunchWizard?: (id: string) => void
  loadError?: string | null
  onRetry?: () => void
  onClearFilters?: () => void
}

export function WorkflowGrid({
  workflows,
  onSelect,
  onOpenLaunchWizard,
  loadError,
  onRetry,
  onClearFilters,
}: WorkflowGridProps) {
  // Sort default: recently edited
  const [sort, setSort] = useState<SortKey>('recent')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')

  // Duplication wizard state
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false)
  const [duplicateYaml, setDuplicateYaml] = useState<string | undefined>()
  const [duplicateId, setDuplicateId] = useState<string | undefined>()

  // Subgraph count
  const hiddenSubgraphsCount = useMemo(() => {
    return workflows.filter((w) => w.kind === 'subgraph').length
  }, [workflows])

  // Recently edited top 4
  const recentlyEdited = useMemo(() => {
    return [...workflows]
      .filter((w) => w.kind !== 'subgraph')
      .sort((a, b) => {
        const ta = a.updated_at ?? a.created_at ?? 0
        const tb = b.updated_at ?? b.created_at ?? 0
        return tb - ta
      })
      .slice(0, 4)
  }, [workflows])

  const recent7dCount = useMemo(() => {
    return workflows.filter((w) => isWithin7Days(w.updated_at ?? w.created_at))
      .length
  }, [workflows])

  const sortedWorkflows = useMemo(() => {
    const copy = [...workflows]
    if (sort === 'alpha') {
      copy.sort((a, b) => a.name.localeCompare(b.name))
    } else if (sort === 'nodes') {
      copy.sort((a, b) => b.node_count - a.node_count)
    } else {
      // 'recent'
      copy.sort((a, b) => {
        const ta = a.updated_at ?? a.created_at ?? 0
        const tb = b.updated_at ?? b.created_at ?? 0
        return tb - ta
      })
    }
    return copy
  }, [workflows, sort])

  function handleDuplicate(wf: WorkflowSummary) {
    setDuplicateYaml(wf.yaml)
    setDuplicateId(`${wf.id}-copy`)
    setDuplicateModalOpen(true)
  }

  // Engine down error takes precedence
  if (loadError) {
    return (
      <div className="wfg-root" style={{ padding: '24px' }}>
        <div className="ban er" role="alert">
          <h3>
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <circle cx="8" cy="8" r="6" />
              <path d="M8 4.5v4M8 11v.5" />
            </svg>
            Workflow engine not reachable
          </h3>
          <p className="txt">
            {loadError}
            <br />
            Nothing was deleted; the library is hidden until the engine answers.
          </p>
          <div className="row" style={{ marginTop: '8px' }}>
            {onRetry && (
              <button
                type="button"
                className="btn red sm"
                onClick={onRetry}
                aria-label="Retry"
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
                  <path d="M13 8a5 5 0 1 1-1.5-3.5" />
                  <path d="M13 2v3h-3" />
                </svg>
                RETRY
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Empty state when 0 workflows match
  if (workflows.length === 0) {
    return (
      <div className="wfg-root" style={{ padding: '32px' }}>
        <div className="qb ctr" style={{ textAlign: 'center' }}>
          <h2 className="big" style={{ fontSize: '16px', fontWeight: 800 }}>
            No workflows match
          </h2>
          <p
            className="txt"
            style={{
              margin: '8px 0 16px',
              color: 'var(--m-text-muted, #8fae9a)',
            }}
          >
            No workflows match the current filters or search query.
          </p>
          {onClearFilters && (
            <button
              type="button"
              className="btn gh sm"
              onClick={onClearFilters}
            >
              CLEAR ALL FILTERS
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="wfg-root main">
      {/* TOOLBAR */}
      <div className="bar">
        <span className="cnt">
          <b>{workflows.length}</b> WORKFLOWS
        </span>
        {hiddenSubgraphsCount > 0 && (
          <span className="meta">
            +{hiddenSubgraphsCount} subgraph
            {hiddenSubgraphsCount > 1 ? 's' : ''} hidden
          </span>
        )}
        <span className="grow" />
        <label className="sl">
          SORT
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Sort workflows"
          >
            <option value="recent">Recently edited</option>
            <option value="alpha">Name A–Z</option>
            <option value="nodes">Most nodes</option>
          </select>
        </label>
        <div className="vt" role="group" aria-label="View">
          <button
            type="button"
            aria-pressed={viewMode === 'grid'}
            onClick={() => setViewMode('grid')}
            title="Grid view"
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
              <path d="M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z" />
            </svg>
            GRID
          </button>
          <button
            type="button"
            aria-pressed={viewMode === 'table'}
            onClick={() => setViewMode('table')}
            title="Table view"
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
              <path d="M2 4h12M2 8h12M2 12h12" />
            </svg>
            TABLE
          </button>
        </div>
      </div>

      <div className="scroll">
        {viewMode === 'grid' ? (
          <>
            {/* RECENTLY EDITED SECTION */}
            {recentlyEdited.length > 0 && (
              <section aria-labelledby="h-rr">
                <div className="sh" style={{ marginBottom: '8px' }}>
                  <h2 id="h-rr">RECENTLY EDITED</h2>
                  <span className="meta">
                    {recent7dCount} in the last 7 days
                  </span>
                  <span className="grow" />
                  <a href="/conductor">RUNS LIVE IN CONDUCTOR →</a>
                </div>
                <div className="rr">
                  {recentlyEdited.map((wf) => (
                    <article key={wf.id} className="rc">
                      <div className="r">
                        {renderOriginChip(wf.source, wf.user_modified)}
                        <span className="grow" />
                        <span className="meta">
                          v{wf.version || '1'} · {formatEditedTime(wf)}
                        </span>
                      </div>
                      <h3 className="t" title={wf.name}>
                        {wf.name}
                      </h3>
                      <p className="l">
                        {wf.node_count} nodes · {formatInputsSummary(wf)} ·
                        valid
                      </p>
                      <NodeTypeBar workflow={wf} width="100%" />
                      <div className="r">
                        <button
                          type="button"
                          className="btn sm p"
                          onClick={() => onSelect(wf.id)}
                          aria-label={`Edit ${wf.name}`}
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
                            <path d="M3 13l1-3.5L11 2.5l2.5 2.5-7 7z" />
                          </svg>
                          EDIT
                        </button>
                        <button
                          type="button"
                          className="btn sm gh"
                          onClick={() => onSelect(wf.id)}
                        >
                          OPEN
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {/* ALL WORKFLOWS GRID */}
            <section aria-labelledby="h-all" style={{ marginTop: '8px' }}>
              <div className="sh" style={{ margin: '6px 0 8px' }}>
                <h2 id="h-all">ALL WORKFLOWS</h2>
                <span className="meta">
                  {sortedWorkflows.length} ·{' '}
                  {sort === 'recent'
                    ? 'recently edited first'
                    : sort === 'nodes'
                      ? 'most nodes first'
                      : 'alphabetical'}
                </span>
              </div>
              <div className="grid">
                {sortedWorkflows.map((wf) => {
                  const cleanedDesc = cleanDescription(wf.description)
                  const tagPrompt =
                    wf.tags.length > 0 ? (
                      <>
                        say <q>{wf.tags[0]}</q>
                        {wf.tags.length > 1 && ` +${wf.tags.length - 1} more`}
                      </>
                    ) : (
                      'no trigger phrases · run from here or Conductor'
                    )

                  return (
                    <article key={wf.id} className="card">
                      <CardGraphPreview workflow={wf} />
                      <div className="cb">
                        <div className="ch">
                          <h3 className="ct">
                            <a
                              href={`#${wf.id}`}
                              onClick={(e) => {
                                e.preventDefault()
                                onSelect(wf.id)
                              }}
                            >
                              {wf.name}
                            </a>
                          </h3>
                          {renderOriginChip(wf.source, wf.user_modified)}
                        </div>
                        <p className="cd" title={cleanedDesc}>
                          {cleanedDesc}
                        </p>
                        <p className="say">{tagPrompt}</p>
                        <div className="cm">
                          <span>
                            <b>{wf.node_count}</b> nodes
                          </span>
                          <span>·</span>
                          <span>
                            <b>
                              {wf.required_inputs.length +
                                wf.optional_inputs.length}
                            </b>{' '}
                            inputs
                          </span>
                          {wf.has_approval && (
                            <span className="chip am">APPROVAL</span>
                          )}
                          {wf.has_loop && <span className="chip yl">LOOP</span>}
                          <span className="grow" />
                          <span>
                            <span className="ok" style={{ border: 0 }}>
                              ✓
                            </span>{' '}
                            valid
                          </span>
                        </div>
                        <div className="cm">
                          <span>
                            v{wf.version || '1'} · edited {formatEditedTime(wf)}
                          </span>
                          <span className="grow" />
                          {wf.run_count > 0 ? (
                            <a
                              className="meta"
                              href={`/conductor?wf=${encodeURIComponent(wf.id)}`}
                              style={{ textDecoration: 'none' }}
                            >
                              last run{' '}
                              <span className="ok" style={{ border: 0 }}>
                                ✓
                              </span>{' '}
                              · Conductor →
                            </a>
                          ) : (
                            <span className="meta">never run</span>
                          )}
                        </div>
                        <div className="ca">
                          <button
                            type="button"
                            className="btn sm p"
                            onClick={() => onSelect(wf.id)}
                            aria-label={`Edit ${wf.name}`}
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
                              <path d="M3 13l1-3.5L11 2.5l2.5 2.5-7 7z" />
                            </svg>
                            EDIT
                          </button>
                          <button
                            type="button"
                            className="btn sm gh"
                            onClick={() => onSelect(wf.id)}
                          >
                            OPEN
                          </button>
                          <button
                            type="button"
                            className="ib"
                            aria-label={`Duplicate ${wf.name}`}
                            title="Duplicate"
                            onClick={() => handleDuplicate(wf)}
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
                              <rect
                                x="5.5"
                                y="5.5"
                                width="8"
                                height="8"
                                rx="1"
                              />
                              <path d="M3.5 10.5h-1v-8h8v1" />
                            </svg>
                          </button>
                          <span className="grow" />
                          <button
                            type="button"
                            className="btn sm gh"
                            aria-label={`Run ${wf.name}`}
                            onClick={() => onOpenLaunchWizard?.(wf.id)}
                          >
                            <svg
                              width="9"
                              height="9"
                              viewBox="0 0 16 16"
                              fill="currentColor"
                              aria-hidden="true"
                            >
                              <path d="M4 2.5v11l9-5.5z" />
                            </svg>
                            RUN…
                          </button>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          </>
        ) : (
          <WorkflowTable
            workflows={sortedWorkflows}
            onSelect={onSelect}
            onOpenLaunchWizard={onOpenLaunchWizard}
          />
        )}
      </div>

      {duplicateModalOpen && (
        <NewWorkflowWizard
          initialYaml={duplicateYaml}
          initialId={duplicateId}
          onClose={() => setDuplicateModalOpen(false)}
        />
      )}
    </div>
  )
}
