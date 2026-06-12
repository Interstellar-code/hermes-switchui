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
export const HERMES_KANBAN_VISIBLE_STATUS_ORDER: Array<Exclude<
  HermesKanbanStatus,
  'archived'
>> = ['triage', 'todo', 'ready', 'running', 'blocked', 'done']

/** Full set including archived — used for filters and migration. */
export const HERMES_KANBAN_ALL_STATUSES: Array<HermesKanbanStatus> = [
  ...HERMES_KANBAN_VISIBLE_STATUS_ORDER,
  'archived',
]

export const HERMES_KANBAN_STATUS_LABELS: Record<HermesKanbanStatus, string> = {
  triage: 'Backlog',
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
  skills: Array<string> | string | null
  block_reason?: string | null
  summary?: string | null
  latest_summary?: string | null
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
  /** Agent API field name is "kind", not "event_type". */
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
  /** Gateway returns either full task objects or bare ID strings — handle both. */
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

/** A single column as returned by the Agent /board endpoint. */
export type HermesKanbanColumn = {
  name: HermesKanbanStatus
  tasks: Array<HermesKanbanTask>
}

export type HermesKanbanBoard = {
  /** Agent API returns columns as an ordered list [{name, tasks}], not a dict. */
  columns: Array<HermesKanbanColumn>
  tenants: Array<string>
  assignees: Array<HermesKanbanAssigneeRaw>
  latest_event_id: number | null
}

/** Convenience: flatten board columns list into a status-keyed map. */
export function boardColumnsToMap(
  columns: Array<HermesKanbanColumn>,
): Record<HermesKanbanStatus, Array<HermesKanbanTask>> {
  const map = {} as Record<HermesKanbanStatus, Array<HermesKanbanTask>>
  for (const col of columns) {
    map[col.name] = col.tasks
  }
  return map
}

// ── Board types ──────────────────────────────────────────────────────────────

/** A kanban board entity as returned by GET /api/plugins/kanban/boards. */
export type BoardMeta = {
  slug: string
  name: string
  description: string
  icon: string
  color: string
  created_at: number | null
  archived: boolean
  db_path?: string
  // Injected by the list endpoint handler
  is_current: boolean
  counts: Record<string, number>
  total: number
}

/** Body for POST /api/plugins/kanban/boards. slug is required (server does NOT derive it). */
export type CreateBoardInput = {
  slug: string
  name?: string
  description?: string
  icon?: string
  color?: string
  switch?: boolean
}

/** Body for PATCH /api/plugins/kanban/boards/{slug}. Slug is immutable. */
export type UpdateBoardInput = {
  name?: string
  description?: string
  icon?: string
  color?: string
}

/** Response shape for GET /api/plugins/kanban/boards. */
export type KanbanBoardsListResponse = {
  boards: Array<BoardMeta>
  current: string
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
  latest_summary?: string | null
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
  /** Hard-delete each task. Only valid for tasks already in 'archived' status. */
  delete?: boolean
}

/** Shape returned by POST /api/hermes-kanban/bulk */
export type BulkResponse = {
  results: Array<{ id: string; ok: boolean; error?: string }>
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

// ── Legacy column mapping ─────────────────────────────────────────────────────

/** Map old SwitchUI task column names to Agent Kanban statuses. */
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
      return 'triage' // review has no Agent status; safer default is triage
    case 'done':
      return 'done'
    default:
      return 'triage'
  }
}

export function normalizeKanbanAssignee(
  raw: HermesKanbanAssigneeRaw,
): HermesKanbanAssignee {
  return {
    id: raw.name,
    name: raw.name,
    label: raw.name,
    isHuman: false, // conservative default; unknown agents are not assumed human
    onDisk: raw.on_disk,
    counts: raw.counts ?? {},
  }
}

// ── Board Templates ───────────────────────────────────────────────────────────

/** A single template variable definition. Backend only validates `key`+`required`; rest passthrough. */
export type TemplateVariable = {
  key: string
  required?: boolean
  description?: string
  default?: string
  prompt?: string
}

/** A task entry within a template definition (passthrough; render read-only). */
export type TemplateTask = {
  key: string
  title: string
  assignee?: string
  status?: string
  body?: string
  priority?: number
  /** Per-task worker runtime cap. Optional positive integer; omit when unset (backend rejects 0/negative/non-int with 422). */
  max_runtime_seconds?: number
  /** Turn budget for goal-mode tasks (pairs with goal_mode). Optional positive integer; omit when unset. */
  goal_max_turns?: number
}

/** Recurrence schedule attached to a template. Cron validated by backend only when enabled is truthy. */
export type TemplateRecurrence = {
  enabled: boolean
  cron?: string
  timezone?: string
}

/** Summary shape returned by GET /templates list endpoint. */
export type KanbanTemplateSummary = {
  slug: string
  name: string
  description: string | null
  color: string | null
  variables: Array<TemplateVariable>
  has_recurrence: boolean
  path: string
}

/** Full template shape returned by GET /templates/{slug}. */
export type KanbanTemplate = {
  schema: number
  slug: string
  name: string
  description?: string
  tasks: Array<TemplateTask>
  variables?: Array<TemplateVariable>
  recurrence?: TemplateRecurrence
  color?: string | null
}

/** Result returned by POST /templates/{slug}/instantiate. */
export type InstantiateResult = {
  ok: boolean
  board_slug: string
  instance_id: string
  task_ids: Array<string>
  created: number
  skipped: number
}

/** Request body for POST /templates/{slug}/instantiate. */
export type InstantiateInput = {
  variables?: Record<string, string>
  board_slug?: string
  auto_dispatch?: boolean
  tenant?: string
}

/** Request body for POST /boards/{slug}/save-as-template. */
export type SaveAsTemplateInput = {
  template_slug: string
  name?: string
  reset_status?: boolean
}
