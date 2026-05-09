import type { ClaudeTask } from '@/lib/tasks-api'
import { COLUMN_COLORS, COLUMN_LABELS } from '@/lib/tasks-api'

const SWIM_STATUSES = ['triage', 'todo', 'ready', 'running', 'blocked'] as const
type SwimStatus = (typeof SWIM_STATUSES)[number]

function roleLabel(assigneeId: string | null): string {
  if (!assigneeId) return 'Awaiting Pickup'
  if (assigneeId === 'research-lead') return 'Domain Specialist'
  return 'Lead Operator'
}

function avatarLetter(assigneeId: string | null): string {
  if (!assigneeId) return '·'
  return assigneeId.charAt(0).toUpperCase()
}

interface SwimRowProps {
  assigneeId: string | null
  label: string
  tasks: ClaudeTask[]
  onCardClick: (task: ClaudeTask) => void
}

function SwimRow({ assigneeId, label, tasks, onCardClick }: SwimRowProps) {
  const activeCount = tasks.filter((t) => t.status !== 'triage').length
  const runningCount = tasks.filter((t) => t.status === 'running').length

  const tasksByStatus = SWIM_STATUSES.reduce<Record<SwimStatus, ClaudeTask[]>>(
    (acc, s) => {
      acc[s] = tasks.filter((t) => t.status === s)
      return acc
    },
    { triage: [], todo: [], ready: [], running: [], blocked: [] },
  )

  return (
    <div className="swim-row">
      <div className="swim-lane">
        <div className={assigneeId ? 'av' : 'av un'}>{avatarLetter(assigneeId)}</div>
        <div className="nm">{label}</div>
        <div className="role">{roleLabel(assigneeId)}</div>
        <div className="stats">
          <span>
            <b>{activeCount}</b> Active
          </span>
          {runningCount > 0 && (
            <span>
              <b>{runningCount}</b> Run
            </span>
          )}
        </div>
      </div>
      <div className="swim-cells">
        {SWIM_STATUSES.map((status) => {
          const colTasks = tasksByStatus[status]
          const colColor = COLUMN_COLORS[status]
          const colLabel = COLUMN_LABELS[status]
          return (
            <div key={status} className="swim-cell">
              <span className="lbl">{colLabel}</span>
              {colTasks.map((task) => (
                <div
                  key={task.id}
                  className="swim-mini"
                  style={{ '--col-color': colColor } as React.CSSProperties}
                  onClick={() => onCardClick(task)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && onCardClick(task)}
                >
                  <span className="id">{task.id.startsWith('T-') ? task.id : `T-${task.id.slice(0, 6)}`}</span>
                  {task.title}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface SwimViewProps {
  tasks: ClaudeTask[]
  assigneeLabels: Record<string, string>
  onCardClick: (task: ClaudeTask) => void
}

export function SwimView({ tasks, assigneeLabels, onCardClick }: SwimViewProps) {
  // Group tasks by assignee
  const byAssignee = new Map<string | null, ClaudeTask[]>()
  for (const task of tasks) {
    const key = task.assignee ?? null
    const arr = byAssignee.get(key) ?? []
    arr.push(task)
    byAssignee.set(key, arr)
  }

  // Build ordered rows: known assignees alpha by label, then null (Unassigned)
  const knownIds = Array.from(byAssignee.keys())
    .filter((k): k is string => k !== null)
    .sort((a, b) => {
      const la = assigneeLabels[a] ?? a
      const lb = assigneeLabels[b] ?? b
      return la.localeCompare(lb)
    })

  const rows: Array<{ assigneeId: string | null; label: string }> = [
    ...knownIds.map((id) => ({ assigneeId: id, label: assigneeLabels[id] ?? id })),
  ]

  // Add Unassigned row if any unassigned tasks
  if (byAssignee.has(null)) {
    rows.push({ assigneeId: null, label: 'Unassigned' })
  }

  if (rows.length === 0) {
    return (
      <div className="swim">
        <p style={{ textAlign: 'center', padding: '3rem', color: 'var(--m-text-faint)' }}>
          No tasks to display.
        </p>
      </div>
    )
  }

  return (
    <div className="swim" aria-label="Swimlanes by assignee">
      {rows.map(({ assigneeId, label }) => (
        <SwimRow
          key={assigneeId ?? '__unassigned__'}
          assigneeId={assigneeId}
          label={label}
          tasks={byAssignee.get(assigneeId) ?? []}
          onCardClick={onCardClick}
        />
      ))}
    </div>
  )
}
