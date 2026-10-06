import { useMemo, useState } from 'react'
import { NewWorkflowWizard } from './new-workflow-wizard'
import { NodeTypeBar } from './workflow-grid'
import { relativeTime } from './types'
import type { WorkflowSource, WorkflowSummary } from './types'

export type TableSortCol =
  | 'name'
  | 'origin'
  | 'nodes'
  | 'inputs'
  | 'version'
  | 'edited'

export type SortDirection = 'asc' | 'desc'

export interface WorkflowTableProps {
  workflows: Array<WorkflowSummary>
  onSelect: (id: string) => void
  onOpenLaunchWizard?: (id: string) => void
  onDuplicate?: (workflow: WorkflowSummary) => void
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

function getScheduleLabel(yaml: string): string | null {
  const match = /^\s*(?:schedule|cron):\s*(['"]?)([^'"\n\r]+)\1/m.exec(yaml)
  return match ? match[2].trim() : null
}

function formatEditedTime(wf: WorkflowSummary): string {
  const ts = wf.updated_at ?? wf.created_at
  if (!ts) return 'Never'
  return relativeTime(ts)
}

export function WorkflowTable({
  workflows,
  onSelect,
  onOpenLaunchWizard: _onOpenLaunchWizard,
  onDuplicate,
}: WorkflowTableProps) {
  // Sort state: default sort is 'edited' descending (newest first)
  const [sortCol, setSortCol] = useState<TableSortCol>('edited')
  const [sortDir, setSortDir] = useState<SortDirection>('desc')

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Hovered row for action visibility
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  // Duplication wizard state
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false)
  const [duplicateYaml, setDuplicateYaml] = useState<string | undefined>()
  const [duplicateId, setDuplicateId] = useState<string | undefined>()

  function handleSortToggle(col: TableSortCol) {
    if (sortCol === col) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  const sortedWorkflows = useMemo(() => {
    const list = [...workflows]
    list.sort((a, b) => {
      let comparison = 0
      switch (sortCol) {
        case 'name':
          comparison = a.name.localeCompare(b.name)
          break
        case 'origin':
          comparison = a.source.localeCompare(b.source)
          break
        case 'nodes':
          comparison = a.node_count - b.node_count
          break
        case 'inputs': {
          const inA = a.required_inputs.length + a.optional_inputs.length
          const inB = b.required_inputs.length + b.optional_inputs.length
          comparison = inA - inB
          break
        }
        case 'version':
          comparison = (a.version || '1').localeCompare(b.version || '1')
          break
        case 'edited': {
          const ta = a.updated_at ?? a.created_at ?? 0
          const tb = b.updated_at ?? b.created_at ?? 0
          comparison = ta - tb
          break
        }
      }
      return sortDir === 'asc' ? comparison : -comparison
    })
    return list
  }, [workflows, sortCol, sortDir])

  // Select all toggle
  const allSelected =
    workflows.length > 0 && selectedIds.size === workflows.length

  function handleSelectAllToggle() {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(workflows.map((w) => w.id)))
    }
  }

  function handleSelectRow(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleDuplicateRow(wf: WorkflowSummary, e: React.MouseEvent) {
    e.stopPropagation()
    if (onDuplicate) {
      onDuplicate(wf)
    } else {
      setDuplicateYaml(wf.yaml)
      setDuplicateId(`${wf.id}-copy`)
      setDuplicateModalOpen(true)
    }
  }

  function handleExportSelected() {
    const selected = workflows.filter((w) => selectedIds.has(w.id))
    if (selected.length === 0) return
    const content = selected
      .map((w) => `# ${w.name} (${w.id})\n${w.yaml}`)
      .join('\n\n---\n\n')
    const blob = new Blob([content], { type: 'text/yaml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `workflows-export-${Date.now()}.yaml`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleDuplicateSelected() {
    const selected = workflows.filter((w) => selectedIds.has(w.id))
    if (selected.length === 1) {
      handleDuplicateRow(selected[0], {
        stopPropagation: () => {},
      } as React.MouseEvent)
    } else if (selected.length > 1) {
      // Duplicate the first one in dialog
      handleDuplicateRow(selected[0], {
        stopPropagation: () => {},
      } as React.MouseEvent)
    }
  }

  // Breakdown of selected items
  const selectedCounts = useMemo(() => {
    let user = 0
    let factory = 0
    let project = 0
    for (const w of workflows) {
      if (selectedIds.has(w.id)) {
        if (w.source === 'user') user++
        else if (w.source === 'project') project++
        else factory++
      }
    }
    return { user, factory, project }
  }, [workflows, selectedIds])

  return (
    <>
      {/* BULK ACTIONS BAR (visible when items selected) */}
      {selectedIds.size > 0 && (
        <div className="bulk" role="region" aria-label="Bulk actions">
          <span>
            <b>{selectedIds.size}</b> selected
          </span>
          <span className="meta">
            {selectedCounts.user > 0 && `${selectedCounts.user} user`}
            {selectedCounts.user > 0 && selectedCounts.factory > 0 && ' · '}
            {selectedCounts.factory > 0 && `${selectedCounts.factory} factory`}
            {selectedCounts.project > 0 &&
              ` · ${selectedCounts.project} project`}
          </span>
          <span className="grow" />
          <button
            type="button"
            className="btn sm"
            onClick={handleExportSelected}
            aria-label={`Export YAML (${selectedIds.size})`}
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
              <path d="M8 2v8M4.5 7L8 10.5 11.5 7M3 13.5h10" />
            </svg>
            EXPORT YAML ({selectedIds.size})
          </button>
          <button
            type="button"
            className="btn sm"
            onClick={handleDuplicateSelected}
            aria-label={`Duplicate (${selectedIds.size})`}
          >
            DUPLICATE ({selectedIds.size})
          </button>
          <button
            type="button"
            className="ib"
            aria-label="Clear selection"
            title="Clear selection"
            onClick={() => setSelectedIds(new Set())}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      )}

      {/* TABLE */}
      <div className="tw">
        <table>
          <caption className="sr">
            All workflows table, sortable columns
          </caption>
          <thead>
            <tr>
              <th scope="col" className="c">
                <input
                  type="checkbox"
                  aria-label={`Select all workflows (${selectedIds.size} of ${workflows.length} selected)`}
                  checked={allSelected}
                  onChange={handleSelectAllToggle}
                />
              </th>
              <th
                scope="col"
                style={{ width: '330px' }}
                aria-sort={
                  sortCol === 'name'
                    ? sortDir === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : undefined
                }
              >
                <button type="button" onClick={() => handleSortToggle('name')}>
                  NAME{' '}
                  {sortCol === 'name' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </button>
              </th>
              <th
                scope="col"
                style={{ width: '84px' }}
                aria-sort={
                  sortCol === 'origin'
                    ? sortDir === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : undefined
                }
              >
                <button
                  type="button"
                  onClick={() => handleSortToggle('origin')}
                >
                  ORIGIN{' '}
                  {sortCol === 'origin' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </button>
              </th>
              <th
                scope="col"
                style={{ width: '58px' }}
                aria-sort={
                  sortCol === 'nodes'
                    ? sortDir === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : undefined
                }
              >
                <button
                  type="button"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => handleSortToggle('nodes')}
                >
                  NODES{' '}
                  {sortCol === 'nodes' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </button>
              </th>
              <th scope="col" style={{ width: '112px' }}>
                <button type="button">TYPES</button>
              </th>
              <th
                scope="col"
                style={{ width: '58px' }}
                aria-sort={
                  sortCol === 'inputs'
                    ? sortDir === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : undefined
                }
              >
                <button
                  type="button"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => handleSortToggle('inputs')}
                >
                  INPUTS{' '}
                  {sortCol === 'inputs' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </button>
              </th>
              <th
                scope="col"
                style={{ width: '44px' }}
                aria-sort={
                  sortCol === 'version'
                    ? sortDir === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : undefined
                }
              >
                <button
                  type="button"
                  onClick={() => handleSortToggle('version')}
                >
                  VER{' '}
                  {sortCol === 'version' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </button>
              </th>
              <th
                scope="col"
                style={{ width: '84px' }}
                aria-sort={
                  sortCol === 'edited'
                    ? sortDir === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : undefined
                }
              >
                <button
                  type="button"
                  onClick={() => handleSortToggle('edited')}
                >
                  EDITED{' '}
                  {sortCol === 'edited' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </button>
              </th>
              <th scope="col" style={{ width: '110px' }}>
                <button type="button">SCHEDULE</button>
              </th>
              <th scope="col" style={{ width: '64px' }}>
                <button type="button">VALID</button>
              </th>
              <th scope="col" style={{ width: '96px' }}>
                <button type="button">LAST RUN</button>
              </th>
              <th scope="col" style={{ width: '122px' }}>
                <span className="sr">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedWorkflows.map((wf) => {
              const isSelected = selectedIds.has(wf.id)
              const isHovered = hoveredId === wf.id
              const totalInputs =
                wf.required_inputs.length + wf.optional_inputs.length
              const schedule = getScheduleLabel(wf.yaml)

              return (
                <tr
                  key={wf.id}
                  className={`${isSelected ? 'sel' : ''}${isHovered ? ' hov' : ''}`}
                  onMouseEnter={() => setHoveredId(wf.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onFocus={() => setHoveredId(wf.id)}
                  onBlur={() => setHoveredId(null)}
                >
                  <td className="c">
                    <input
                      type="checkbox"
                      aria-label={`Select ${wf.name}`}
                      checked={isSelected}
                      onClick={(e) => handleSelectRow(wf.id, e)}
                      onChange={() => {}}
                    />
                  </td>
                  <td>
                    <span className="nm">
                      <a
                        href={`#${wf.id}`}
                        onClick={(e) => {
                          e.preventDefault()
                          onSelect(wf.id)
                        }}
                      >
                        {wf.name}
                      </a>
                    </span>
                    <span className="id">{wf.id}</span>
                  </td>
                  <td>{renderOriginChip(wf.source, wf.user_modified)}</td>
                  <td className="num">{wf.node_count}</td>
                  <td>
                    <NodeTypeBar workflow={wf} width="96px" />
                  </td>
                  <td className="num">
                    {totalInputs > 0 ? (
                      totalInputs
                    ) : (
                      <span className="na">0</span>
                    )}
                  </td>
                  <td>v{wf.version || '1'}</td>
                  <td>
                    <span>{formatEditedTime(wf)}</span>
                  </td>
                  <td>
                    {schedule ? (
                      <span className="chip cy">
                        CRON · {schedule.toUpperCase()}
                      </span>
                    ) : (
                      <span className="na">—</span>
                    )}
                  </td>
                  <td>
                    <span className="ok" style={{ border: 0 }}>
                      ✓
                    </span>{' '}
                    valid
                  </td>
                  <td>
                    {wf.run_count > 0 ? (
                      <a
                        className="na"
                        href={`/conductor?wf=${encodeURIComponent(wf.id)}`}
                        style={{ textDecoration: 'none' }}
                        title="Open runs in Conductor"
                      >
                        <span style={{ color: '#00ff41' }}>
                          <span className="pulse" /> running · ok
                        </span>
                      </a>
                    ) : (
                      <a
                        className="na"
                        href={`/conductor?wf=${encodeURIComponent(wf.id)}`}
                        style={{ textDecoration: 'none' }}
                        title="Open runs in Conductor"
                      >
                        <span className="na">
                          <span className="g">○</span>never
                        </span>
                      </a>
                    )}
                  </td>
                  <td>
                    <div
                      className="acts"
                      style={{ visibility: isHovered ? 'visible' : 'hidden' }}
                    >
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
                        className="ib"
                        aria-label={`Duplicate ${wf.name}`}
                        title="Duplicate"
                        onClick={(e) => handleDuplicateRow(wf, e)}
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
                          <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
                          <path d="M3.5 10.5h-1v-8h8v1" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="ib"
                        aria-label={`More actions for ${wf.name}`}
                        title="More actions"
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelect(wf.id)
                        }}
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 16 16"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <circle cx="3.5" cy="8" r="1.3" />
                          <circle cx="8" cy="8" r="1.3" />
                          <circle cx="12.5" cy="8" r="1.3" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="foot">
        <span>{workflows.length} workflows</span>
        <span>·</span>
        <span>{sortedWorkflows.length} shown</span>
        <span>·</span>
        <span>row actions on hover / focus</span>
        <span>·</span>
        <span>runs and history live in Conductor; last run links there</span>
      </div>

      {duplicateModalOpen && (
        <NewWorkflowWizard
          initialYaml={duplicateYaml}
          initialId={duplicateId}
          onClose={() => setDuplicateModalOpen(false)}
        />
      )}
    </>
  )
}
