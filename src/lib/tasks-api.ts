/**
 * tasks-api.ts — Agent Kanban-backed frontend task API.
 *
 * All calls go through the Workspace proxy routes at /api/hermes-kanban/*.
 * The legacy /api/claude-tasks routes are deprecated (see Task 16).
 */
import {
  HERMES_KANBAN_STATUS_LABELS,
  HERMES_KANBAN_VISIBLE_STATUS_ORDER,
  boardColumnsToMap,
  kanbanPriorityColor,
} from './hermes-kanban-types'
import type {
  CreateKanbanTaskInput,
  HermesKanbanAssignee,
  HermesKanbanBoard,
  HermesKanbanStatus,
  HermesKanbanTask,
  UpdateKanbanTaskInput,
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
export type AssigneesResponse = {
  assignees: Array<HermesKanbanAssignee>
  humanReviewer: null
}

const KANBAN_BASE = '/api/hermes-kanban'

async function kanbanJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string
      detail?: string
    }
    throw new Error(
      body.error ?? body.detail ?? `Request failed: ${res.status}`,
    )
  }
  return res.json() as Promise<T>
}

export async function fetchAssignees(): Promise<AssigneesResponse> {
  try {
    const data = await kanbanJson<{ assignees: Array<HermesKanbanAssignee> }>(
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
}): Promise<Array<HermesKanbanTask>> {
  const q = new URLSearchParams()
  if (params?.tenant) q.set('tenant', params.tenant)
  if (params?.include_archived) q.set('include_archived', 'true')
  const qs = q.toString()
  const data = await kanbanJson<{ board: HermesKanbanBoard }>(
    `${KANBAN_BASE}/board${qs ? `?${qs}` : ''}`,
  )
  const board = data.board
  // Agent API returns columns as [{name, tasks}] list — convert to a status map
  const colMap = boardColumnsToMap(board.columns ?? [])
  // Build the list of statuses to collect from colMap.
  // HERMES_KANBAN_VISIBLE_STATUS_ORDER excludes 'archived', so we append it
  // explicitly when the caller requested archived tasks.
  const statuses: Array<HermesKanbanStatus> = [
    ...(params?.include_done
      ? HERMES_KANBAN_VISIBLE_STATUS_ORDER
      : HERMES_KANBAN_VISIBLE_STATUS_ORDER.filter((s) => s !== 'done')),
    ...(params?.include_archived ? (['archived'] as Array<HermesKanbanStatus>) : []),
  ]

  const tasks: Array<HermesKanbanTask> = []
  for (const status of statuses) {
    const col = colMap[status]
    if (Array.isArray(col)) tasks.push(...col)
  }
  if (params?.assignee)
    return tasks.filter((t) => t.assignee === params.assignee)
  return tasks
}

export async function createTask(
  input: CreateKanbanTaskInput,
): Promise<HermesKanbanTask> {
  const data = await kanbanJson<{ task: HermesKanbanTask }>(
    `${KANBAN_BASE}/tasks`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
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
 * deleteTask → archive. Soft-delete; task moves to the Archived column.
 */
export async function deleteTask(taskId: string): Promise<void> {
  await updateTask(taskId, { status: 'archived' })
}

/**
 * hardDeleteTask → permanent removal via DELETE.
 * Only call this on tasks that are already archived.
 */
export async function hardDeleteTask(taskId: string): Promise<void> {
  await kanbanJson<{ ok: boolean }>(`${KANBAN_BASE}/tasks/${taskId}`, {
    method: 'DELETE',
  })
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

/**
 * Link two tasks: parentId becomes a blocker of childId.
 * Uses POST /api/hermes-kanban/links.
 */
export async function addLink(parentId: string, childId: string): Promise<void> {
  await kanbanJson<{ ok: true }>(`${KANBAN_BASE}/links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parent_id: parentId, child_id: childId }),
  })
}

/**
 * Remove a parent→child link.
 * Uses DELETE /api/hermes-kanban/links?parent_id=...&child_id=...
 */
export async function removeLink(parentId: string, childId: string): Promise<void> {
  const q = new URLSearchParams({ parent_id: parentId, child_id: childId })
  await kanbanJson<{ ok: boolean }>(`${KANBAN_BASE}/links?${q}`, { method: 'DELETE' })
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

export type KanbanStats = {
  by_status?: Partial<Record<HermesKanbanStatus, number>>
  by_assignee?: Record<string, Partial<Record<HermesKanbanStatus, number>>>
  oldest_ready_age_seconds?: number | null
  oldest_running_age_seconds?: number | null
  now?: number
  [k: string]: unknown
}

export async function fetchStats(): Promise<KanbanStats> {
  const res = await kanbanJson<{ stats?: KanbanStats } | KanbanStats>(`${KANBAN_BASE}/stats`)
  // Gateway returns { stats: {...} }; some proxies may flatten — handle both
  if (res && typeof res === 'object' && 'stats' in res && res.stats) return res.stats as KanbanStats
  return res as KanbanStats
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

export type KanbanConfig = {
  default_tenant?: string
  lane_by_profile?: boolean
  include_archived_by_default?: boolean
  render_markdown?: boolean
  [k: string]: unknown
}

export async function fetchKanbanConfig(): Promise<KanbanConfig> {
  return kanbanJson<KanbanConfig>(`${KANBAN_BASE}/config`)
}

export type HomeChannel = {
  platform: string
  chat_id?: string
  thread_id?: string
  name?: string
  subscribed?: boolean
  [k: string]: unknown
}

export async function fetchHomeChannels(taskId?: string): Promise<{ channels: Array<HomeChannel> }> {
  const q = taskId ? `?task_id=${encodeURIComponent(taskId)}` : ''
  const res = await kanbanJson<{ home_channels?: Array<HomeChannel>; channels?: Array<HomeChannel> }>(
    `${KANBAN_BASE}/home-channels${q}`,
  )
  return { channels: res.home_channels ?? res.channels ?? [] }
}

export async function subscribeHomeChannel(taskId: string, platform: string): Promise<void> {
  await kanbanJson(`${KANBAN_BASE}/tasks/${taskId}/home-subscribe/${platform}`, {
    method: 'POST',
  })
}

export async function unsubscribeHomeChannel(taskId: string, platform: string): Promise<void> {
  await kanbanJson(`${KANBAN_BASE}/tasks/${taskId}/home-subscribe/${platform}`, {
    method: 'DELETE',
  })
}
