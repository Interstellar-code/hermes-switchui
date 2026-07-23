/**
 * Server-only client for the Hermes Agent Dashboard Projects plugin.
 *
 * All HTTP calls use dashboardFetch() from gateway-capabilities.ts — never
 * import this module in client-side code.
 */
import { dashboardFetch } from './gateway-capabilities'
import { getActiveProfileName } from './profiles-browser'
import type {
  AddProjectFolderInput,
  CreateProjectInput,
  ProjectActivityResponse,
  ProjectDetailResponse,
  ProjectFoldersResponse,
  ProjectsListResponse,
  SessionProjectBindingResponse,
  SessionProjectResolution,
  SessionProjectUnbindResponse,
  UpdateProjectInput,
} from '../lib/projects-types'

const BASE = '/api/plugins/projects'

// Mirrors KANBAN_FETCH_TIMEOUT_MS — must exceed the worst-case dashboardFetch
// auth flow (cold-cache 401 retry: two 3s HTML-scrape token fetches).
const PROJECTS_FETCH_TIMEOUT_MS = 12_000

function projectsErrorDetail(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback
  const value =
    (body as { detail?: unknown; error?: unknown }).detail ??
    (body as { error?: unknown }).error
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const messages = value.flatMap((item) =>
      item && typeof item === 'object' && typeof item.msg === 'string'
        ? [item.msg]
        : [],
    )
    if (messages.length) return messages.join('; ')
  }
  return fallback
}

async function projectsFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const separator = path.includes('?') ? '&' : '?'
  const scopedPath = `${path}${separator}profile=${encodeURIComponent(getActiveProfileName())}`
  const res = await dashboardFetch(scopedPath, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(PROJECTS_FETCH_TIMEOUT_MS),
  })
  if (!res.ok) {
    let detail = `Projects API error ${res.status}`
    try {
      detail = projectsErrorDetail(await res.json(), detail)
    } catch {
      // ignore parse failure
    }
    throw new Error(`Projects API error ${res.status}: ${detail}`)
  }
  return res.json() as Promise<T>
}

export function projectsErrorStatus(error: unknown, fallback = 503): number {
  if (!(error instanceof Error)) return fallback
  const match = /^Projects API error (\d{3}):/.exec(error.message)
  return match ? Number(match[1]) : fallback
}

export async function listProjects(
  includeArchived = false,
): Promise<ProjectsListResponse> {
  const q = new URLSearchParams()
  if (includeArchived) q.set('include_archived', 'true')
  const qs = q.toString()
  return projectsFetch<ProjectsListResponse>(`${BASE}${qs ? `?${qs}` : ''}`, {})
}

export async function getProject(
  idOrSlug: string,
): Promise<ProjectDetailResponse> {
  return projectsFetch<ProjectDetailResponse>(
    `${BASE}/${encodeURIComponent(idOrSlug)}`,
    {},
  )
}

export async function getProjectFolders(
  idOrSlug: string,
): Promise<ProjectFoldersResponse> {
  return projectsFetch<ProjectFoldersResponse>(
    `${BASE}/${encodeURIComponent(idOrSlug)}/folders`,
    {},
  )
}

export async function getProjectActivity(
  idOrSlug: string,
  opts?: { limit?: number; cursor?: string | null },
): Promise<ProjectActivityResponse> {
  const q = new URLSearchParams()
  q.set('limit', String(opts?.limit ?? 10))
  if (opts?.cursor != null) q.set('cursor', opts.cursor)
  return projectsFetch<ProjectActivityResponse>(
    `${BASE}/${encodeURIComponent(idOrSlug)}/activity?${q.toString()}`,
    {},
  )
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }
}

async function mutateProject<T>(path: string, init: RequestInit): Promise<T> {
  return projectsFetch<T>(path, init)
}

export function createProject(
  input: CreateProjectInput,
): Promise<ProjectDetailResponse> {
  return mutateProject<ProjectDetailResponse>(BASE, jsonInit('POST', input))
}

export function updateProject(
  idOrSlug: string,
  input: UpdateProjectInput,
): Promise<ProjectDetailResponse> {
  return mutateProject<ProjectDetailResponse>(
    `${BASE}/${encodeURIComponent(idOrSlug)}`,
    jsonInit('PATCH', input),
  )
}

export function addProjectFolder(
  idOrSlug: string,
  input: AddProjectFolderInput,
): Promise<ProjectDetailResponse> {
  return mutateProject<ProjectDetailResponse>(
    `${BASE}/${encodeURIComponent(idOrSlug)}/folders`,
    jsonInit('POST', input),
  )
}

export function removeProjectFolder(
  idOrSlug: string,
  path: string,
): Promise<ProjectDetailResponse> {
  return mutateProject<ProjectDetailResponse>(
    `${BASE}/${encodeURIComponent(idOrSlug)}/folders`,
    jsonInit('DELETE', { path }),
  )
}

export function setPrimaryProjectFolder(
  idOrSlug: string,
  path: string,
): Promise<ProjectDetailResponse> {
  return mutateProject<ProjectDetailResponse>(
    `${BASE}/${encodeURIComponent(idOrSlug)}/folders/primary`,
    jsonInit('POST', { path }),
  )
}

export function archiveProject(
  idOrSlug: string,
): Promise<ProjectDetailResponse> {
  return mutateProject<ProjectDetailResponse>(
    `${BASE}/${encodeURIComponent(idOrSlug)}/archive`,
    jsonInit('POST'),
  )
}

export function restoreProject(
  idOrSlug: string,
): Promise<ProjectDetailResponse> {
  return mutateProject<ProjectDetailResponse>(
    `${BASE}/${encodeURIComponent(idOrSlug)}/restore`,
    jsonInit('POST'),
  )
}

export function setActiveProject(
  idOrSlug: string,
): Promise<ProjectsListResponse> {
  return mutateProject<ProjectsListResponse>(
    `${BASE}/${encodeURIComponent(idOrSlug)}/active`,
    jsonInit('POST'),
  )
}

export function resolveSessionProject(
  sessionId: string,
): Promise<SessionProjectResolution> {
  return projectsFetch<SessionProjectResolution>(
    `${BASE}/session/${encodeURIComponent(sessionId)}`,
  )
}

export function bindSessionProject(
  sessionId: string,
  projectSlug: string,
): Promise<SessionProjectBindingResponse> {
  return mutateProject<SessionProjectBindingResponse>(
    `${BASE}/session?session_id=${encodeURIComponent(sessionId)}`,
    jsonInit('POST', { project_slug: projectSlug, bound_by: 'switchui' }),
  )
}

export function unbindSessionProject(
  sessionId: string,
): Promise<SessionProjectUnbindResponse> {
  return mutateProject<SessionProjectUnbindResponse>(
    `${BASE}/session/${encodeURIComponent(sessionId)}`,
    jsonInit('DELETE'),
  )
}

export function deleteProject(idOrSlug: string): Promise<ProjectsListResponse> {
  return mutateProject<ProjectsListResponse>(
    `${BASE}/${encodeURIComponent(idOrSlug)}`,
    jsonInit('DELETE'),
  )
}
