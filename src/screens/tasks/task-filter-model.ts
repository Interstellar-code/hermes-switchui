import type {
  HermesKanbanAssignee,
  HermesKanbanStatus,
  HermesKanbanTask,
} from '@/lib/hermes-kanban-types'
import { HERMES_KANBAN_ALL_STATUSES } from '@/lib/hermes-kanban-types'

export const UNASSIGNED_FILTER = '__unassigned__'

export type AssigneeFilterOption = {
  id: string
  label: string
  kind: 'profile' | 'historical'
  isActive: boolean
  visibleCount: number
  totalCount: number
  counts: Partial<Record<HermesKanbanStatus, number>>
}

export function assigneeMatches(
  task: HermesKanbanTask,
  filter: string | null,
): boolean {
  if (!filter) return true
  if (filter === UNASSIGNED_FILTER) return task.assignee == null
  return task.assignee === filter
}

export function countStatuses(tasks: Array<HermesKanbanTask>) {
  const counts = Object.fromEntries(
    HERMES_KANBAN_ALL_STATUSES.map((status) => [status, 0]),
  ) as Record<HermesKanbanStatus, number>
  for (const task of tasks) counts[task.status] += 1
  return counts
}

export function buildAssigneeFilterOptions({
  profiles,
  activeProfile,
  assignees,
  visibleTasks,
  scopedTasks,
}: {
  profiles: Array<{ name: string }>
  activeProfile?: string | null
  assignees: Array<HermesKanbanAssignee>
  visibleTasks: Array<HermesKanbanTask>
  scopedTasks: Array<HermesKanbanTask>
}): Array<AssigneeFilterOption> {
  const profileNames = new Set(profiles.map((profile) => profile.name))
  const byId = new Map(assignees.map((assignee) => [assignee.id, assignee]))
  const ids = new Set([
    ...profileNames,
    ...scopedTasks.flatMap((task) => (task.assignee ? [task.assignee] : [])),
  ])

  return [...ids]
    .map((id) => {
      const counts = countStatuses(
        scopedTasks.filter((task) => task.assignee === id),
      )
      return {
        id,
        label: byId.get(id)?.label ?? id,
        kind: profileNames.has(id) ? 'profile' : 'historical',
        isActive: id === activeProfile,
        visibleCount: visibleTasks.filter((task) => task.assignee === id).length,
        totalCount: Object.values(counts).reduce((sum, count) => sum + count, 0),
        counts,
      } satisfies AssigneeFilterOption
    })
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'profile' ? -1 : 1
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
      return a.id.localeCompare(b.id)
    })
}
