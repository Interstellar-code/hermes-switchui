import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  BubbleChatIcon,
  CpuIcon,
  HierarchyIcon,
} from '@hugeicons/core-free-icons'
import type { ClaudeTask } from '@/lib/tasks-api'
import {
  kanbanPriorityColor,
  kanbanPriorityLabel,
} from '@/lib/hermes-kanban-types'
import { cn } from '@/lib/utils'

// Heartbeat staleness threshold: 5 minutes
const STALE_HEARTBEAT_MS = 5 * 60 * 1000

type Props = {
  task: ClaudeTask
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

export function TaskCard({
  task,
  assigneeLabels = {},
  onClick,
  onDragStart,
  isDragging,
}: Props) {
  const priority = typeof task.priority === 'number' ? task.priority : 0
  const priorityColor = kanbanPriorityColor(priority)
  const priorityLabel = kanbanPriorityLabel(priority)
  const assigneeLabel = formatTaskAssigneeLabel(task.assignee, assigneeLabels)

  // Staleness: running tasks with no heartbeat in 5+ minutes
  const isStale =
    task.status === 'running' &&
    task.last_heartbeat_at !== null &&
    task.last_heartbeat_at !== undefined &&
    Date.now() / 1000 - (task.last_heartbeat_at) >
      STALE_HEARTBEAT_MS / 1000

  const hasSpawnError =
    (task.spawn_failures ?? 0) > 0 || !!task.last_spawn_error
  const commentCount = task.comment_count ?? 0
  const linkParents = task.link_counts?.parents ?? 0
  const linkChildren = task.link_counts?.children ?? 0
  const progress = task.progress

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className={cn(
        'relative rounded-lg border p-3 cursor-pointer transition-all select-none',
        'bg-[var(--theme-card)] border-[var(--theme-border)]',
        'hover:border-[var(--theme-accent)]',
        isDragging
          ? 'opacity-40 rotate-1 shadow-2xl'
          : 'hover:shadow-[0_4px_16px_rgba(0,0,0,0.35)]',
      )}
      style={{ borderLeftWidth: 3, borderLeftColor: priorityColor }}
    >
      {/* Priority dot */}
      <span
        className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full shrink-0"
        style={{ background: priorityColor }}
        title={`Priority: ${priorityLabel}`}
      />

      <p className="text-sm font-medium text-[var(--theme-text)] leading-snug mb-1 line-clamp-2 pr-4">
        {task.title}
      </p>

      {task.body && (
        <p className="text-xs text-[var(--theme-muted)] line-clamp-2 mb-2">
          {task.body}
        </p>
      )}

      {/* Execution metadata badges */}
      <div className="flex items-center gap-1.5 flex-wrap mt-2">
        {/* Assignee */}
        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--theme-hover)] text-[var(--theme-muted)]">
          {assigneeLabel}
        </span>

        {/* Comment count */}
        {commentCount > 0 && (
          <span
            className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--theme-hover)] text-[var(--theme-muted)]"
            title={`${commentCount} comment${commentCount !== 1 ? 's' : ''}`}
          >
            <HugeiconsIcon icon={BubbleChatIcon} size={10} />
            {commentCount}
          </span>
        )}

        {/* TODO: show "🔒 blocked by N" amber badge when any parent is non-done (needs parent status data, not just count) */}
        {/* Dependency/subtask links */}
        {(linkParents > 0 || linkChildren > 0) && (
          <span
            className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--theme-hover)] text-[var(--theme-muted)]"
            title={`${linkParents} parent${linkParents !== 1 ? 's' : ''}, ${linkChildren} child${linkChildren !== 1 ? 'ren' : ''}`}
          >
            <HugeiconsIcon icon={HierarchyIcon} size={10} />
            {linkParents > 0 && <span>↑{linkParents}</span>}
            {linkChildren > 0 && <span>↓{linkChildren}</span>}
          </span>
        )}

        {/* Child progress */}
        {progress && progress.total > 0 && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--theme-hover)] text-[var(--theme-muted)]"
            title={`${progress.done}/${progress.total} subtasks done`}
          >
            {progress.done}/{progress.total}
          </span>
        )}

        {/* Worker PID for running tasks */}
        {task.status === 'running' && task.worker_pid && !isStale && (
          <span
            className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--theme-hover)] text-[var(--theme-muted)]"
            title={`Worker PID ${task.worker_pid}`}
          >
            <HugeiconsIcon icon={CpuIcon} size={10} />
            {task.worker_pid}
          </span>
        )}

        {/* Stale running indicator */}
        {isStale && (
          <span
            className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-400"
            title="Worker heartbeat is overdue — may be stale"
          >
            <HugeiconsIcon icon={Alert02Icon} size={10} />
            stale
          </span>
        )}

        {/* Spawn failure badge */}
        {hasSpawnError && (
          <span
            className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md bg-red-500/20 text-red-400"
            title={
              task.last_spawn_error ?? `${task.spawn_failures} spawn failure(s)`
            }
          >
            <HugeiconsIcon icon={Alert02Icon} size={10} />
            failed spawn
          </span>
        )}
      </div>
    </div>
  )
}
