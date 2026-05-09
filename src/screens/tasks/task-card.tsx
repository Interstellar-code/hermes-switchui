import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  BubbleChatIcon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  CpuIcon,
  GitBranchIcon,
  HierarchyIcon,
} from '@hugeicons/core-free-icons'
import { deriveTags } from './tag-taxonomy'
import type { ClaudeTask } from '@/lib/tasks-api'
import {
  kanbanPriorityLabel,
} from '@/lib/hermes-kanban-types'
import { cn } from '@/lib/utils'

// Heartbeat staleness threshold: 5 minutes
const STALE_HEARTBEAT_MS = 5 * 60 * 1000

type Props = {
  task: ClaudeTask
  colColor?: string
  assigneeLabels?: Record<string, string>
  onClick: () => void
  onDragStart: (e: React.DragEvent) => void
  isDragging?: boolean
}

export function formatTaskAssigneeLabel(
  assignee: string | null,
  assigneeLabels: Record<string, string>,
): string {
  const resolvedLabel = assignee
    ? (assigneeLabels[assignee] ?? assignee)
    : 'Unassigned'
  return `Assignee: ${resolvedLabel}`
}

/** Short task ID: T-{last4} when last 4 chars are numeric, else T-{last6hex}.
 *  Matches mockup convention: T-127, T-132. */
function shortId(id: string): string {
  const last4 = id.slice(-4)
  if (/^\d+$/.test(last4)) return `T-${last4}`
  return `T-${id.slice(-6).toUpperCase()}`
}

export function TaskCard({
  task,
  colColor = 'var(--m-green-500, #00ff41)',
  assigneeLabels = {},
  onClick,
  onDragStart,
  isDragging,
}: Props) {
  const priority = typeof task.priority === 'number' ? task.priority : 0
  const priorityLabel = kanbanPriorityLabel(priority)

  const isRunning = task.status === 'running'

  // Staleness: running tasks with no heartbeat in 5+ minutes
  const isStale =
    isRunning &&
    task.last_heartbeat_at !== null &&
    Date.now() / 1000 - task.last_heartbeat_at > STALE_HEARTBEAT_MS / 1000

  const hasSpawnError =
    task.spawn_failures > 0 || !!task.last_spawn_error
  const commentCount = task.comment_count ?? 0
  const linkParents = task.link_counts?.parents ?? 0
  const linkChildren = task.link_counts?.children ?? 0
  const progress = task.progress

  // Extended fields not yet in HermesKanbanTask schema — accessed defensively
  const extTask = task as Record<string, unknown>
  // Subtasks = link_counts.children (canonical schema field)
  const subtaskCount = linkChildren > 0 ? linkChildren : null
  const checksPassed = typeof extTask.checks_passed === 'number' ? extTask.checks_passed : null
  const checksTotal = typeof extTask.checks_total === 'number' ? extTask.checks_total : null
  const tokensTotal = typeof extTask.tokens_total === 'number' ? extTask.tokens_total
    : typeof (extTask.metadata as Record<string,unknown> | undefined)?.tokens === 'number'
      ? (extTask.metadata as Record<string,unknown>).tokens as number
      : null

  const assignee = task.assignee ?? null
  const assigneeLabel = assignee ? (assigneeLabels[assignee] ?? assignee) : null
  const avatarLetter = assigneeLabel ? assigneeLabel[0].toUpperCase() : '·'

  const tags = deriveTags(task)

  // Inline CSS var for col-color — used by .card::after and hover box-shadow
  const colStyle = { '--col-color': colColor } as React.CSSProperties

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onClick()
    }
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`Task: ${task.title}. Priority: ${priorityLabel}. Status: ${task.status}.`}
      style={colStyle}
      className={cn(
        'card',
        isDragging && 'opacity-40 rotate-1 shadow-2xl',
      )}
      title={`Priority: ${priorityLabel}`}
    >
      {/* Title + status dot */}
      <p className="ttl line-clamp-2 pr-1">{task.title}</p>
      <span
        className={cn('stat-dot', isRunning && !isStale && 'live')}
        title={isRunning ? 'Live' : task.status}
      />

      {/* Description */}
      {task.body && (
        <p className="desc">{task.body}</p>
      )}

      {/* Tags */}
      {tags.length > 0 && (
        <div className="tagrow">
          {tags.map((tag) => (
            <span key={tag.label} className={`tag tag-${tag.kind}`}>
              {tag.label}
            </span>
          ))}
        </div>
      )}

      {/* Progress strip — only when running AND progress exists */}
      {isRunning && progress && progress.total > 0 && (
        <div className="prog">
          <i style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
        </div>
      )}

      {/* Footer */}
      <div className="foot">
        {/* Assignee avatar + name */}
        <span className="as">
          <span className={cn('av', !assignee && 'un')}>{avatarLetter}</span>
          {assigneeLabel && <b>{assigneeLabel}</b>}
        </span>

        {/* Icon cluster (right) */}
        <span className="icoct">
          {commentCount > 0 && (
            <span className="ic" title={`${commentCount} comment${commentCount !== 1 ? 's' : ''}`}>
              <HugeiconsIcon icon={BubbleChatIcon} size={11} />
              {commentCount}
            </span>
          )}

          {/* Branch / subtask count — shown only when > 0 */}
          {subtaskCount !== null && subtaskCount > 0 && (
            <span className="ic" title={`${subtaskCount} subtask${subtaskCount !== 1 ? 's' : ''}`}>
              <HugeiconsIcon icon={GitBranchIcon} size={11} />
              {subtaskCount}
            </span>
          )}

          {/* Checks ratio — show real data when available; placeholder 0/1 when running */}
          {(checksPassed !== null && checksTotal !== null) ? (
            <span className="ic" title={`Checks: ${checksPassed}/${checksTotal}`}>
              <HugeiconsIcon icon={CheckmarkCircle02Icon} size={11} />
              {checksPassed}/{checksTotal}
            </span>
          ) : isRunning ? (
            <span className="ic" title="Checks: 0/1 (placeholder)">
              <HugeiconsIcon icon={CheckmarkCircle02Icon} size={11} />
              0/1
            </span>
          ) : null}

          {/* Tokens total — omit when unavailable */}
          {tokensTotal !== null && (
            <span className="ic" title={`${tokensTotal.toLocaleString()} tokens`}>
              <HugeiconsIcon icon={Clock01Icon} size={11} />
              {tokensTotal >= 1000 ? `${Math.round(tokensTotal / 1000)}k` : tokensTotal}
            </span>
          )}

          {linkParents > 0 && (
            <span
              className="ic up"
              title={`${linkParents} parent${linkParents !== 1 ? 's' : ''}`}
            >
              <HugeiconsIcon icon={HierarchyIcon} size={11} />
              ↑{linkParents}
            </span>
          )}

          {isRunning && task.worker_pid && !isStale && (
            <span className="ic" title={`Worker PID ${task.worker_pid}`}>
              <HugeiconsIcon icon={CpuIcon} size={11} />
              {task.worker_pid}
            </span>
          )}

          {isStale && (
            <span className="ic" title="Worker heartbeat overdue — may be stale" style={{ color: '#ffb454' }}>
              <HugeiconsIcon icon={Alert02Icon} size={11} />
              stale
            </span>
          )}

          {hasSpawnError && (
            <span className="ic" style={{ color: '#ff5fa2' }} title={task.last_spawn_error ?? `${task.spawn_failures} spawn failure(s)`}>
              <HugeiconsIcon icon={Alert02Icon} size={11} />
              err
            </span>
          )}
        </span>

        {/* T-id badge — bottom-right grid area */}
        <span className="id">{shortId(task.id)}</span>
      </div>
    </div>
  )
}
