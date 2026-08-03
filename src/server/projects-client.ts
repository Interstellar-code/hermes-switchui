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

export function explicitProjectProfile(request: Request): string | undefined {
  const value = new URL(request.url).searchParams.get('profile')?.trim()
  return value || undefined
}

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
  profile?: string,
): Promise<T> {
  const separator = path.includes('?') ? '&' : '?'
  const scopedPath = `${path}${separator}profile=${encodeURIComponent(profile || getActiveProfileName())}`
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
  profile?: string,
): Promise<ProjectsListResponse> {
  const q = new URLSearchParams()
  if (includeArchived) q.set('include_archived', 'true')
  const qs = q.toString()
  return projectsFetch<ProjectsListResponse>(`${BASE}${qs ? `?${qs}` : ''}`, {}, profile)
}

export async function getProject(
  idOrSlug: string,
  profile?: string,
): Promise<ProjectDetailResponse> {
  return projectsFetch<ProjectDetailResponse>(
    `${BASE}/${encodeURIComponent(idOrSlug)}`,
    {}, profile,
  )
}

export async function getProjectFolders(
  idOrSlug: string,
  profile?: string,
): Promise<ProjectFoldersResponse> {
  return projectsFetch<ProjectFoldersResponse>(
    `${BASE}/${encodeURIComponent(idOrSlug)}/folders`,
    {}, profile,
  )
}

export async function getProjectActivity(
  idOrSlug: string,
  opts?: { limit?: number; cursor?: string | null },
  profile?: string,
): Promise<ProjectActivityResponse> {
  const q = new URLSearchParams()
  q.set('limit', String(opts?.limit ?? 10))
  if (opts?.cursor != null) q.set('cursor', opts.cursor)
  return projectsFetch<ProjectActivityResponse>(
    `${BASE}/${encodeURIComponent(idOrSlug)}/activity?${q.toString()}`,
    {}, profile,
  )
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }
}

async function mutateProject<T>(path: string, init: RequestInit, profile?: string): Promise<T> {
  return projectsFetch<T>(path, init, profile)
}

export function createProject(
  input: CreateProjectInput,
  profile?: string,
): Promise<ProjectDetailResponse> {
  return mutateProject<ProjectDetailResponse>(BASE, jsonInit('POST', input), profile)
}

export function updateProject(
  idOrSlug: string,
  input: UpdateProjectInput,
  profile?: string,
): Promise<ProjectDetailResponse> {
  return mutateProject<ProjectDetailResponse>(
    `${BASE}/${encodeURIComponent(idOrSlug)}`,
    jsonInit('PATCH', input), profile,
  )
}

export function addProjectFolder(
  idOrSlug: string,
  input: AddProjectFolderInput,
  profile?: string,
): Promise<ProjectDetailResponse> {
  return mutateProject<ProjectDetailResponse>(
    `${BASE}/${encodeURIComponent(idOrSlug)}/folders`,
    jsonInit('POST', input), profile,
  )
}

export function removeProjectFolder(
  idOrSlug: string,
  path: string,
  profile?: string,
): Promise<ProjectDetailResponse> {
  return mutateProject<ProjectDetailResponse>(
    `${BASE}/${encodeURIComponent(idOrSlug)}/folders`,
    jsonInit('DELETE', { path }), profile,
  )
}

export function setPrimaryProjectFolder(
  idOrSlug: string,
  path: string,
  profile?: string,
): Promise<ProjectDetailResponse> {
  return mutateProject<ProjectDetailResponse>(
    `${BASE}/${encodeURIComponent(idOrSlug)}/folders/primary`,
    jsonInit('POST', { path }), profile,
  )
}

export function archiveProject(
  idOrSlug: string,
  profile?: string,
): Promise<ProjectDetailResponse> {
  return mutateProject<ProjectDetailResponse>(
    `${BASE}/${encodeURIComponent(idOrSlug)}/archive`,
    jsonInit('POST'), profile,
  )
}

export function restoreProject(
  idOrSlug: string,
  profile?: string,
): Promise<ProjectDetailResponse> {
  return mutateProject<ProjectDetailResponse>(
    `${BASE}/${encodeURIComponent(idOrSlug)}/restore`,
    jsonInit('POST'), profile,
  )
}

export function setActiveProject(
  idOrSlug: string,
  profile?: string,
): Promise<ProjectsListResponse> {
  return mutateProject<ProjectsListResponse>(
    `${BASE}/${encodeURIComponent(idOrSlug)}/active`,
    jsonInit('POST'), profile,
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

export function deleteProject(idOrSlug: string, profile?: string): Promise<ProjectsListResponse> {
  return mutateProject<ProjectsListResponse>(
    `${BASE}/${encodeURIComponent(idOrSlug)}`,
    jsonInit('DELETE'), profile,
  )
}
