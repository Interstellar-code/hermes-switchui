/**
 * Canonical Agent Kanban types and helpers for SwitchUI.
 *
 * All persistence uses Agent statuses (triage/todo/ready/running/blocked/done/archived).
 * UI labels may be friendlier but must not invent new persisted states.
 */

// ── Status ──────────────────────────────────────────────────────────────────

export type HermesKanbanStatus =
  | 'triage'
  | 'todo'
  | 'ready'
  | 'running'
  | 'blocked'
  | 'done'
  | 'archived'

/** Ordered list of statuses shown as board columns (archived hidden by default). */
export const HERMES_KANBAN_VISIBLE_STATUS_ORDER: Exclude<HermesKanbanStatus, 'archived'>[] = [
  'triage', 'todo', 'ready', 'running', 'blocked', 'done',
]

/** Full set including archived — used for filters and migration. */
export const HERMES_KANBAN_ALL_STATUSES: HermesKanbanStatus[] = [
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

// ── Task types ───────────────────────────────────────────────────────────────

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
  skills: string[] | string | null
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
  event_type: string
  payload: unknown
  created_at: number
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
}

export type HermesKanbanLinks = {
  parents: HermesKanbanTask[]
  children: HermesKanbanTask[]
}

export type HermesKanbanTaskDetail = {
  task: HermesKanbanTask
  comments: HermesKanbanComment[]
  events: HermesKanbanEvent[]
  links: HermesKanbanLinks
  runs: HermesKanbanRun[]
}

export type HermesKanbanBoard = {
  columns: Record<HermesKanbanStatus, HermesKanbanTask[]>
  tenants: string[]
  assignees: HermesKanbanAssigneeRaw[]
  latest_event_id: number | null
}

// ── Assignees ────────────────────────────────────────────────────────────────

export type HermesKanbanAssigneeRaw = {
  name: string
  on_disk: boolean
  counts: Record<string, number>
}

export type HermesKanbanAssignee = {
  id: string
  name: string
  label: string
  isHuman: boolean
  onDisk: boolean
  counts: Record<string, number>
}

// ── Create / Update inputs ────────────────────────────────────────────────────

export type CreateKanbanTaskInput = {
  title: string
  body?: string | null
  assignee?: string | null
  tenant?: string | null
  priority?: number
  workspace_kind?: string | null
  workspace_path?: string | null
  parents?: string[]
  triage?: boolean
  idempotency_key?: string
  max_runtime_seconds?: number | null
  skills?: string[] | null
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
}

export type BulkKanbanInput = {
  ids: string[]
  status?: HermesKanbanStatus
  assignee?: string | null
  priority?: number
  archive?: boolean
}

// ── Priority helpers ──────────────────────────────────────────────────────────

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

/** Map old string priority labels to Agent numeric values. */
export function mapLegacyPriorityToNumeric(priority: string): number {
  switch (priority.toLowerCase()) {
    case 'high': return 3
    case 'medium': return 1
    case 'low': return -1
    default: return 0
  }
}

// ── Legacy column mapping ─────────────────────────────────────────────────────

/** Map old SwitchUI task column names to Agent Kanban statuses. */
export function mapLegacyColumnToKanbanStatus(column: string): HermesKanbanStatus {
  switch (column) {
    case 'backlog': return 'triage'
    case 'todo': return 'todo'
    case 'in_progress': return 'running'
    case 'review': return 'triage' // review has no Agent status; safer default is triage
    case 'done': return 'done'
    default: return 'triage'
  }
}


export function normalizeKanbanAssignee(raw: HermesKanbanAssigneeRaw): HermesKanbanAssignee {
  return {
    id: raw.name,
    name: raw.name,
    label: raw.name,
    isHuman: false, // conservative default; unknown agents are not assumed human
    onDisk: raw.on_disk,
    counts: raw.counts ?? {},
  }
}
