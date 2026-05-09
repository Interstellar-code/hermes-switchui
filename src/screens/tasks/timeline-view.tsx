'use client'

import type { ClaudeTask } from '@/lib/tasks-api'
import { COLUMN_COLORS } from '@/lib/tasks-api'

interface TimelineViewProps {
  tasks: ClaudeTask[]
  onCardClick: (task: ClaudeTask) => void
}

const TICKS = ['-6h', '-5h', '-4h', '-3h', '-2h', '-1h', 'now', '+1h', '+2h', '+3h', '+4h', '+5h']
// Mark '-1h' (index 5) so its right edge aligns with the body now-line at 50%
const NOW_TICK_INDEX = 5

interface BarLayout {
  left: number   // percent
  width: number  // percent
  label: string
  live: boolean
  ghost: boolean
}

function hashJitter(id: string, range: number): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0
  return (Math.abs(h) % 1000) / 1000 * range
}

function computeBar(task: ClaudeTask, now: number): BarLayout {
  const status = task.status

  if (status === 'running') {
    const startedMs = task.started_at ? task.started_at * 1000 : now
    const hoursAgo = (now - startedMs) / (1000 * 60 * 60)
    // Each hour = 8.33% of track (12h total)
    const left = Math.max(0, Math.min(49, 50 - hoursAgo * 8.333))
    const pct = task.progress
      ? Math.round((task.progress.done / Math.max(task.progress.total, 1)) * 100)
      : 25
    // Remaining portion of the 12h window
    const width = Math.max(10, Math.min(40, pct * 0.4))
    return { left, width, label: `running ${pct}%`, live: true, ghost: false }
  }

  if (status === 'todo' || status === 'ready') {
    const left = 60 // ~+1h slot
    const width = 18 + hashJitter(task.id, 4) // 18-22%, stable per task id
    return { left, width, label: 'scheduled +1h', live: false, ghost: true }
  }

  if (status === 'blocked') {
    return { left: 50, width: 20, label: 'blocked', live: false, ghost: true }
  }

  // triage / backlog
  const left = 75 + hashJitter(task.id, 8) // 75-83%, stable per task id
  const width = 20
  return { left, width, label: 'planned +3h', live: false, ghost: true }
}

function statusOrder(status: string): number {
  if (status === 'running') return 0
  if (status === 'todo' || status === 'ready') return 1
  if (status === 'triage') return 2
  if (status === 'blocked') return 3
  return 4
}

export function TimelineView({ tasks, onCardClick }: TimelineViewProps) {
  const now = Date.now()

  const visibleTasks = tasks
    .filter((t) => t.status !== 'done' && t.status !== 'archived')
    .sort((a, b) => {
      const order = statusOrder(a.status) - statusOrder(b.status)
      if (order !== 0) return order
      // running: most progress first
      if (a.status === 'running' && b.status === 'running') {
        const ap = a.progress ? a.progress.done / Math.max(a.progress.total, 1) : 0
        const bp = b.progress ? b.progress.done / Math.max(b.progress.total, 1) : 0
        return bp - ap
      }
      return 0
    })
    .slice(0, 12)

  return (
    <div className="tl-wrap">
      {/* Head row */}
      <div className="tl-head">
        <div className="lbl">Task · 12h horizon</div>
        <div className="ticks">
          {TICKS.map((tick, i) => (
            <span key={tick} className={i === NOW_TICK_INDEX ? 'now' : undefined}>
              {tick}
            </span>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="tl-body">
        {visibleTasks.length === 0 && (
          <div className="tl-empty">No active tasks to display</div>
        )}
        {visibleTasks.map((task) => {
          const colColor = COLUMN_COLORS[task.status] ?? '#6b7280'
          const bar = computeBar(task, now)
          const statusLabel = task.status.charAt(0).toUpperCase() + task.status.slice(1)
          const pctDisplay = task.progress
            ? ` · ${Math.round((task.progress.done / Math.max(task.progress.total, 1)) * 100)}%`
            : ''
          const assigneeDisplay = task.assignee ?? 'unassigned'

          return (
            <div key={task.id} className="tl-row">
              <div
                className="meta"
                role="button"
                tabIndex={0}
                onClick={() => onCardClick(task)}
                onKeyDown={(e) => e.key === 'Enter' && onCardClick(task)}
                style={{ cursor: 'pointer' }}
              >
                <span className="id">{task.id} · {statusLabel}</span>
                <span className="ttl">{task.title}</span>
                <span className="as">{assigneeDisplay}{pctDisplay}</span>
              </div>
              <div className="tl-track">
                <div className="now" style={{ left: '50%' }} />
                <div
                  className={['tl-bar', bar.live ? 'live' : '', bar.ghost ? 'ghost' : ''].filter(Boolean).join(' ')}
                  style={{
                    '--col-color': colColor,
                    left: `${bar.left}%`,
                    width: `${bar.width}%`,
                  } as React.CSSProperties}
                  role="button"
                  tabIndex={0}
                  onClick={() => onCardClick(task)}
                  onKeyDown={(e) => e.key === 'Enter' && onCardClick(task)}
                >
                  {bar.label}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
