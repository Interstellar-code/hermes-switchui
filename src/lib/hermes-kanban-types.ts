/**
 * Canonical Hermes Agent Kanban types and helpers for Workspace.
 *
 * Persistence uses Agent-native statuses only:
 * triage/todo/ready/running/blocked/done/archived.
 */

export type HermesKanbanStatus =
  | 'triage'
  | 'todo'
  | 'ready'
  | 'running'
  | 'blocked'
  | 'done'
  | 'archived'

export const HERMES_KANBAN_VISIBLE_STATUS_ORDER: Array<Exclude<
  HermesKanbanStatus,
  'archived'
>> = ['triage', 'todo', 'ready', 'running', 'blocked', 'done']

export const HERMES_KANBAN_ALL_STATUSES: Array<HermesKanbanStatus> = [
  ...HERMES_KANBAN_VISIBLE_STATUS_ORDER,
  'archived',
]

export const HERMES_KANBAN_STATUS_LABELS: Record<HermesKanbanStatus, string> = {
  triage: 'Backlog / Triage',
  todo: 'Todo',
  ready: 'Ready',
  running: 'Running',
  blocked: 'Blocked',
  done: 'Done',
  archived: 'Archived',
}

export type HermesKanbanTask = {
  id: string
  title: string
  body: string | null
  assignee: string | null
  status: HermesKanbanStatus
  priority: number
  created_by: string | null
  created_at: number
  started_at: number | null
  completed_at: number | null
  workspace_kind: string | null
  workspace_path: string | null
  claim_lock: string | null
  claim_expires: number | null
  tenant: string | null
  result: string | null
  spawn_failures: number
  worker_pid: number | null
  last_spawn_error: string | null
  max_runtime_seconds: number | null
  last_heartbeat_at: number | null
  current_run_id: number | null
  workflow_template_id: string | null
  current_step_key: string | null
  skills: Array<string> | string | null
  block_reason?: string | null
  summary?: string | null
  age?: {
    created_age_seconds: number
    started_age_seconds: number | null
    time_to_complete_seconds: number | null
  }
  link_counts?: { parents: number; children: number }
  comment_count?: number
  progress?: { done: number; total: number } | null
}

export type HermesKanbanComment = {
  id: number
  task_id: string
  body: string
  author: string | null
  created_at: number
}

export type HermesKanbanEvent = {
  id: number
  task_id: string
  kind: string
  payload: unknown
  created_at: number
  run_id: number | null
}

export type HermesKanbanRun = {
  id: number
  task_id: string
  status: string
  worker_pid: number | null
  started_at: number | null
  ended_at: number | null
  exit_code: number | null
  error: string | null
  summary?: string | null
  metadata?: Record<string, unknown> | null
  outcome?: 'completed' | 'blocked' | 'crashed' | 'timeout' | string | null
}

export type HermesKanbanLinks = {
  parents: Array<HermesKanbanTask | string>
  children: Array<HermesKanbanTask | string>
}

export type HermesKanbanTaskDetail = {
  task: HermesKanbanTask
  comments: Array<HermesKanbanComment>
  events: Array<HermesKanbanEvent>
  links: HermesKanbanLinks
  runs: Array<HermesKanbanRun>
}

export type HermesKanbanColumn = {
  name: HermesKanbanStatus
  tasks: Array<HermesKanbanTask>
}

export type HermesKanbanAssigneeRaw = {
  name: string
  on_disk: boolean
  counts: Record<string, number>
}

export type HermesKanbanBoard = {
  columns: Array<HermesKanbanColumn>
  tenants: Array<string>
  assignees: Array<HermesKanbanAssigneeRaw>
  latest_event_id: number | null
}

export type HermesKanbanAssignee = {
  id: string
  name: string
  label: string
  isHuman: boolean
  onDisk: boolean
  counts: Record<string, number>
}

export function boardColumnsToMap(
  columns: Array<HermesKanbanColumn>,
): Record<HermesKanbanStatus, Array<HermesKanbanTask>> {
  const map = {} as Record<HermesKanbanStatus, Array<HermesKanbanTask>>
  for (const col of columns) map[col.name] = col.tasks
  return map
}

export function normalizeKanbanAssignee(
  raw: HermesKanbanAssigneeRaw,
): HermesKanbanAssignee {
  const label = raw.name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
  return {
    id: raw.name,
    name: raw.name,
    label,
    isHuman: false,
    onDisk: raw.on_disk,
    counts: raw.counts ?? {},
  }
}

export type CreateKanbanTaskInput = {
  title: string
  body?: string | null
  assignee?: string | null
  tenant?: string | null
  priority?: number
  workspace_kind?: string | null
  workspace_path?: string | null
  parents?: Array<string>
  triage?: boolean
  idempotency_key?: string
  max_runtime_seconds?: number | null
  skills?: Array<string> | null
}

export type UpdateKanbanTaskInput = {
  status?: HermesKanbanStatus
  assignee?: string | null
  priority?: number
  title?: string
  body?: string | null
  result?: string | null
  block_reason?: string | null
  summary?: string | null
  workspace_kind?: string | null
  workspace_path?: string | null
  skills?: Array<string> | null
  claim_lock?: string | null
  worker_pid?: number | null
  claimed_at?: number | null
  spawn_failures?: number | null
  last_spawn_error?: string | null
}

export type BulkKanbanInput = {
  ids: Array<string>
  status?: HermesKanbanStatus
  assignee?: string | null
  priority?: number
  archive?: boolean
}

export function kanbanPriorityLabel(priority: number): string {
  if (priority >= 3) return 'High'
  if (priority >= 1) return 'Medium'
  if (priority === 0) return 'Normal'
  return 'Low'
}

export function kanbanPriorityColor(priority: number): string {
  if (priority >= 3) return '#ef4444'
  if (priority >= 1) return '#f97316'
  if (priority === 0) return '#6b7280'
  return '#94a3b8'
}

export function mapLegacyPriorityToNumeric(priority: string): number {
  switch (priority.toLowerCase()) {
    case 'high':
      return 3
    case 'medium':
      return 1
    case 'low':
      return -1
    default:
      return 0
  }
}

export function mapLegacyColumnToKanbanStatus(
  column: string,
): HermesKanbanStatus {
  switch (column) {
    case 'backlog':
      return 'triage'
    case 'todo':
      return 'todo'
    case 'in_progress':
      return 'running'
    case 'review':
      return 'triage'
    case 'done':
      return 'done'
    default:
      return 'triage'
  }
}
