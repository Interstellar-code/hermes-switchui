/**
 * tasks-api.ts — Agent Kanban-backed frontend task API.
 *
 * All calls go through the Workspace proxy routes at /api/hermes-kanban/*.
 * The legacy /api/claude-tasks routes are deprecated (see Task 16).
 */
import type {
  HermesKanbanTask,
  HermesKanbanStatus,
  HermesKanbanBoard,
  HermesKanbanAssignee,
  CreateKanbanTaskInput,
  UpdateKanbanTaskInput,
} from './hermes-kanban-types'
import {
  HERMES_KANBAN_VISIBLE_STATUS_ORDER,
  HERMES_KANBAN_STATUS_LABELS,
  kanbanPriorityColor,
} from './hermes-kanban-types'

export type { HermesKanbanTask as ClaudeTask, HermesKanbanStatus as TaskColumn }

// Re-export for screen compat
export { HERMES_KANBAN_STATUS_LABELS as COLUMN_LABELS }
export { HERMES_KANBAN_VISIBLE_STATUS_ORDER as COLUMN_ORDER }

// Legacy compat type shims
export type TaskPriority = 'high' | 'medium' | 'low'
export type CreateTaskInput = CreateKanbanTaskInput
export type UpdateTaskInput = UpdateKanbanTaskInput

export type TaskAssignee = HermesKanbanAssignee
export type AssigneesResponse = { assignees: HermesKanbanAssignee[]; humanReviewer: null }

const KANBAN_BASE = '/api/hermes-kanban'

async function kanbanJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string; detail?: string }
    throw new Error(body.error ?? body.detail ?? `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function fetchAssignees(): Promise<AssigneesResponse> {
  try {
    const data = await kanbanJson<{ assignees: HermesKanbanAssignee[] }>(
      `${KANBAN_BASE}/assignees`,
    )
    return { assignees: data.assignees, humanReviewer: null }
  } catch {
    return { assignees: [], humanReviewer: null }
  }
}

export async function fetchTasks(params?: {
  tenant?: string
  assignee?: string
  include_done?: boolean
  include_archived?: boolean
}): Promise<HermesKanbanTask[]> {
  const q = new URLSearchParams()
  if (params?.tenant) q.set('tenant', params.tenant)
  if (params?.include_archived) q.set('include_archived', 'true')
  const qs = q.toString()
  const data = await kanbanJson<{ board: HermesKanbanBoard }>(
    `${KANBAN_BASE}/board${qs ? `?${qs}` : ''}`,
  )
  const board = data.board
  const statuses = params?.include_done
    ? HERMES_KANBAN_VISIBLE_STATUS_ORDER
    : HERMES_KANBAN_VISIBLE_STATUS_ORDER.filter((s) => s !== 'done')

  const tasks: HermesKanbanTask[] = []
  for (const status of statuses) {
    const col = board.columns?.[status as HermesKanbanStatus]
    if (Array.isArray(col)) tasks.push(...col)
  }
  if (params?.assignee) return tasks.filter((t) => t.assignee === params.assignee)
  return tasks
}

export async function createTask(
  input: CreateKanbanTaskInput,
): Promise<HermesKanbanTask> {
  const data = await kanbanJson<{ task: HermesKanbanTask }>(`${KANBAN_BASE}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return data.task
}

export async function updateTask(
  taskId: string,
  input: UpdateKanbanTaskInput,
): Promise<HermesKanbanTask> {
  const data = await kanbanJson<{ task: HermesKanbanTask }>(
    `${KANBAN_BASE}/tasks/${taskId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  return data.task
}

/**
 * deleteTask → archive. Agent Kanban has no hard-delete endpoint.
 * UI copy should say "Archive" to match actual behavior.
 */
export async function deleteTask(taskId: string): Promise<void> {
  await updateTask(taskId, { status: 'archived' })
}

export async function moveTask(
  taskId: string,
  status: HermesKanbanStatus,
): Promise<HermesKanbanTask> {
  return updateTask(taskId, { status })
}

export function priorityColor(priority: number): string {
  return kanbanPriorityColor(priority)
}

// ── Legacy compat shims (Task 5 bridge — removed in Task 6/7) ────────────────

/** @deprecated Agent Kanban tasks have no due_date field. Always returns false. */
export function isOverdue(_task: HermesKanbanTask): boolean {
  return false
}

/**
 * @deprecated Priority is now numeric in Agent Kanban. Use kanbanPriorityColor(task.priority).
 * Kept as a Record to avoid breaking task-card.tsx until Task 7 updates it.
 */
export const PRIORITY_COLORS: Record<string, string> = {
  high: '#ef4444',
  medium: '#f97316',
  low: '#6b7280',
  3: '#ef4444',
  1: '#f97316',
  0: '#6b7280',
  '-1': '#94a3b8',
}

export const COLUMN_COLORS: Record<HermesKanbanStatus, string> = {
  triage: '#6b7280',
  todo: '#3b82f6',
  ready: '#8b5cf6',
  running: '#f97316',
  blocked: '#ef4444',
  done: '#22c55e',
  archived: '#94a3b8',
}

