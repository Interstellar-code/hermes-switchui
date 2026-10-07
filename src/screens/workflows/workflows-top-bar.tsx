import { useMemo } from 'react'
import { useWorkflowFeatures } from './use-workflows'
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
}

export function computeWorkflowStats(
  workflows: Array<WorkflowSummary>,
): HeaderStats {
  let user = 0
  let project = 0
  let factory = 0
  let withApproval = 0
  let edited7d = 0

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
  }
}

export interface WorkflowsTopBarProps {
  workflows?: Array<WorkflowSummary>
  templateCount?: number
  onRefresh?: () => void
  /** Engine unreachable: stats show "—" instead of zeros. */
  engineDown?: boolean
}

export function WorkflowsTopBar({
  workflows,
  templateCount = 0,
  onRefresh,
  engineDown = false,
}: WorkflowsTopBarProps) {
  const { data: features } = useWorkflowFeatures()

  const stats = useMemo(() => {
    if (engineDown) return null
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
    }
  }, [workflows, templateCount, engineDown])

  // Pill only from real feature data: schedulerAlive true/false; hidden while
  // unknown (query pending/failed) so we never invent "scheduler ok".
  const schedulerKnown = features != null
  const schedulerAlive = features?.schedulerAlive === true
  const profile = features?.profile

  function statValue(n: number): string {
    return stats ? String(n) : '—'
  }

  return (
    <header className="wf-top top" aria-label="Workflows header">
      <div className="wf-top-left">
        <span className="crumb">
          SWITCH UI › <b>WORKFLOWS</b> · TEMPLATE LIBRARY
        </span>
        {schedulerKnown && (
          <span
            className={`pchip${schedulerAlive ? '' : ' down'}`}
            title={
              schedulerAlive
                ? 'Engine scheduler reports alive'
                : 'Engine scheduler reports down'
            }
          >
            <span
              className={`dot${schedulerAlive ? '' : ' down'}`}
              aria-hidden="true"
            />
            {profile ? `${profile} · ` : ''}
            {schedulerAlive ? 'scheduler ok' : 'scheduler down'}
          </span>
        )}
      </div>

      <span className="grow" />

      <div
        className="wf-top-stats"
        role="region"
        aria-label="Workflow statistics"
      >
        <div className="st" title={`${stats?.total ?? 0} total workflows`}>
          <span className="v">{statValue(stats?.total ?? 0)}</span>
          <span className="l">WORKFLOWS</span>
        </div>
        <div
          className="st st-user"
          title={`${stats?.user ?? 0} user workflows`}
        >
          <span className="v">{statValue(stats?.user ?? 0)}</span>
          <span className="l">USER</span>
        </div>
        <div
          className="st st-project"
          title={`${stats?.project ?? 0} project workflows`}
        >
          <span className="v">{statValue(stats?.project ?? 0)}</span>
          <span className="l">PROJECT</span>
        </div>
        <div className="st" title={`${stats?.factory ?? 0} factory workflows`}>
          <span className="v">{statValue(stats?.factory ?? 0)}</span>
          <span className="l">FACTORY</span>
        </div>
        <div
          className="st st-approval"
          title={`${stats?.withApproval ?? 0} workflows with approval gates`}
        >
          <span className="v">{statValue(stats?.withApproval ?? 0)}</span>
          <span className="l">WITH APPROVAL</span>
        </div>
        <div
          className="st"
          title={`${stats?.edited7d ?? 0} workflows edited in 7 days`}
        >
          <span className="v">{statValue(stats?.edited7d ?? 0)}</span>
          <span className="l">EDITED 7D</span>
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
