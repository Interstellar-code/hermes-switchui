/**
 * Canonical Projects types for SwitchUI.
 *
 * Mirrors the Hermes Agent Dashboard `projects` plugin REST contract
 * (`/api/plugins/projects/*`). Read-only v1 — no create/edit/delete.
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
