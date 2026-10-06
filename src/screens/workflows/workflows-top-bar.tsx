import { useMemo } from 'react'
import type { WorkflowSummary } from './types'

const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000

export function isWithin7Days(ts: number | string | null | undefined): boolean {
  if (!ts) return false
  const epoch =
    typeof ts === 'number'
      ? ts < 1e11
        ? ts * 1000
        : ts
      : new Date(ts).getTime()
  if (isNaN(epoch) || epoch <= 0) return false
  const diff = Date.now() - epoch
  return diff >= 0 && diff <= SEVEN_DAYS_MS
}

export interface HeaderStats {
  total: number
  user: number
  project: number
  factory: number
  withApproval: number
  edited7d: number
  yamlErrors: number
}

export function computeWorkflowStats(
  workflows: Array<WorkflowSummary>,
): HeaderStats {
  let user = 0
  let project = 0
  let factory = 0
  let withApproval = 0
  let edited7d = 0
  const yamlErrors = 0

  for (const w of workflows) {
    if (w.source === 'user') {
      user++
    } else if (w.source === 'project') {
      project++
    } else {
      factory++
    }

    if (w.has_approval) {
      withApproval++
    }
    if (isWithin7Days(w.updated_at ?? w.created_at)) {
      edited7d++
    }
  }

  return {
    total: workflows.length,
    user,
    project,
    factory,
    withApproval,
    edited7d,
    yamlErrors,
  }
}

export interface WorkflowsTopBarProps {
  workflows?: Array<WorkflowSummary>
  templateCount?: number
  onRefresh?: () => void
}

export function WorkflowsTopBar({
  workflows,
  templateCount = 0,
  onRefresh,
}: WorkflowsTopBarProps) {
  const stats = useMemo(() => {
    if (workflows) {
      return computeWorkflowStats(workflows)
    }
    return {
      total: templateCount,
      user: 0,
      project: 0,
      factory: templateCount,
      withApproval: 0,
      edited7d: 0,
      yamlErrors: 0,
    }
  }, [workflows, templateCount])

  return (
    <header className="wf-top top" aria-label="Workflows header">
      <div className="wf-top-left">
        <span className="crumb">
          SWITCH UI › <b>WORKFLOWS</b> · TEMPLATE LIBRARY
        </span>
        <span className="pchip" title="Scheduler operational">
          <span className="dot" style={{ background: '#00ff41' }} />
          hermes-switch · scheduler ok
        </span>
      </div>

      <span className="grow" />

      <div
        className="wf-top-stats"
        role="region"
        aria-label="Workflow statistics"
      >
        <div className="st" title={`${stats.total} total workflows`}>
          <span className="v">{stats.total}</span>
          <span className="l">WORKFLOWS</span>
        </div>
        <div className="st" title={`${stats.user} user workflows`}>
          <span className="v" style={{ color: '#5ad3ff' }}>
            {stats.user}
          </span>
          <span className="l">USER</span>
        </div>
        <div className="st" title={`${stats.project} project workflows`}>
          <span className="v" style={{ color: '#bf97ff' }}>
            {stats.project}
          </span>
          <span className="l">PROJECT</span>
        </div>
        <div className="st" title={`${stats.factory} factory workflows`}>
          <span className="v">{stats.factory}</span>
          <span className="l">FACTORY</span>
        </div>
        <div
          className="st"
          title={`${stats.withApproval} workflows with approval gates`}
        >
          <span className="v" style={{ color: '#ffb454' }}>
            {stats.withApproval}
          </span>
          <span className="l">WITH APPROVAL</span>
        </div>
        <div
          className="st"
          title={`${stats.edited7d} workflows edited in 7 days`}
        >
          <span className="v">{stats.edited7d}</span>
          <span className="l">EDITED 7D</span>
        </div>
        <div className="st" title={`${stats.yamlErrors} YAML errors`}>
          <span className="v">{stats.yamlErrors}</span>
          <span className="l">YAML ERRORS</span>
        </div>
      </div>

      <button
        type="button"
        className="ib"
        aria-label="Refresh"
        title="Refresh workflows"
        onClick={onRefresh}
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
      </button>
    </header>
  )
}
