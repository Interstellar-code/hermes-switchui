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
