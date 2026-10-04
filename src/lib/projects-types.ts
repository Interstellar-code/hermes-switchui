/**
 * Canonical Projects types for SwitchUI.
 *
 * Mirrors the Hermes Agent Dashboard `projects` plugin REST contract
 * (`/api/plugins/projects/*`).
 */

export type Project = {
  id: string
  slug: string
  name: string
  description: string | null
  icon: string | null
  color: string | null
  board_slug: string | null
  primary_path: string | null
  archived: boolean
  created_at: number | null
  folders: Array<ProjectFolder>
  bound_board: BoundBoard | null
  folder_count: number
  task_count: number
  open_task_count: number
  task_status_counts: Record<string, number>
  session_count: number
  last_task_activity_at: number | null
  last_session_activity_at: number | null
  last_activity_at: number | null
  is_active: boolean
}

export type BoundBoard = {
  slug: string
  name: string
  description: string
  icon: string
  color: string
  archived: boolean
}

// Confirmed against backend `projects_db.ProjectFolder.to_dict()`.
export type ProjectFolder = {
  path: string
  label: string | null
  is_primary: boolean
  added_at: number
}

export type ProjectsListResponse = {
  projects: Array<Project>
  active_id: string | null
}

export type ProjectDetailResponse = {
  project: Project
}

export type ProjectFoldersResponse = {
  project_id: string
  folders: Array<ProjectFolder>
}

export type ProjectActivityTaskItem = {
  kind: 'task'
  id: string
  occurred_at: number
  event_kind: string
  board_slug: string
  title: string
  status: string
  assignee: string | null
  created_at: number
}

export type ProjectActivitySessionItem = {
  kind: 'session'
  id: string
  occurred_at: number
  title: string | null
  preview: string
  source: string
  model: string
  message_count: number
  cwd: string
}

export type ProjectActivityItem =
  | ProjectActivityTaskItem
  | ProjectActivitySessionItem

export type ProjectActivityResponse = {
  project_id: string
  items: Array<ProjectActivityItem>
  next_cursor: string | null
}

export type CreateProjectInput = {
  name: string
  slug?: string
  folders?: Array<string>
  primary_path?: string
  description?: string
  icon?: string
  color?: string
  board_slug?: string
}

export type UpdateProjectInput = {
  name?: string
  description?: string
  icon?: string
  color?: string
  board_slug?: string
}

export type AddProjectFolderInput = {
  path: string
  label?: string
  is_primary?: boolean
}

export type ProjectMutationResponse = ProjectDetailResponse

/** The small project reference returned when resolving a chat's project. */
export type SessionProjectRef = Pick<Project, 'id' | 'slug' | 'name'>

/** `new` / blank = a chat not created yet: never bind, unbind or resolve it. */
export function isPlaceholderSessionKey(sessionKey: string): boolean {
  const key = sessionKey.trim()
  return key === '' || key === 'new' || key === 'main'
}

export type SessionProjectResolution = {
  session_id: string
  project: SessionProjectRef | null
  source: 'binding' | 'active' | null
}

export type SessionProjectBindingResponse = {
  binding: unknown
  project: Pick<Project, 'id'>
}

export type SessionProjectUnbindResponse = {
  session_id: string
  removed: number
}

/** `GET /api/session-folders` — every explicit session→project binding for a profile. */
export type SessionProjectMap = {
  version: string | null
  projects: Array<{
    id: string
    slug: string
    name: string
    icon: string | null
    color: string | null
    archived: boolean
    board_slug: string | null
  }>
  /** session_id → project_id */
  sessions: Record<string, string>
  /** Sessions whose folder is inherited from an earlier session in their chain (no explicit binding). */
  inherited?: Record<string, true>
  /** session_id → the ancestor whose explicit binding gives it its folder (compression or inheritance). */
  binding_owner?: Record<string, string>
  /** project_id → bound sessions the dashboard would list (no children/delegates/archived). Absent on the fallback path. */
  counts?: Record<string, number>
  /** Same as the dashboard's profile_totals for this profile. */
  listable_total?: number
  /** listable_total − listable bound sessions. */
  unfiled?: number
}
