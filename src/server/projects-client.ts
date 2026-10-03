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
  return projectsFetch<ProjectsListResponse>(
    `${BASE}${qs ? `?${qs}` : ''}`,
    {},
    profile,
  )
}

export async function getProject(
  idOrSlug: string,
  profile?: string,
): Promise<ProjectDetailResponse> {
  return projectsFetch<ProjectDetailResponse>(
    `${BASE}/${encodeURIComponent(idOrSlug)}`,
    {},
    profile,
  )
}

export async function getProjectFolders(
  idOrSlug: string,
  profile?: string,
): Promise<ProjectFoldersResponse> {
  return projectsFetch<ProjectFoldersResponse>(
    `${BASE}/${encodeURIComponent(idOrSlug)}/folders`,
    {},
    profile,
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
    {},
    profile,
  )
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }
}

async function mutateProject<T>(
  path: string,
  init: RequestInit,
  profile?: string,
): Promise<T> {
  return projectsFetch<T>(path, init, profile)
}

export function createProject(
  input: CreateProjectInput,
  profile?: string,
): Promise<ProjectDetailResponse> {
  return mutateProject<ProjectDetailResponse>(
    BASE,
    jsonInit('POST', input),
    profile,
  )
}

export function updateProject(
  idOrSlug: string,
  input: UpdateProjectInput,
  profile?: string,
): Promise<ProjectDetailResponse> {
  return mutateProject<ProjectDetailResponse>(
    `${BASE}/${encodeURIComponent(idOrSlug)}`,
    jsonInit('PATCH', input),
    profile,
  )
}

export function addProjectFolder(
  idOrSlug: string,
  input: AddProjectFolderInput,
  profile?: string,
): Promise<ProjectDetailResponse> {
  return mutateProject<ProjectDetailResponse>(
    `${BASE}/${encodeURIComponent(idOrSlug)}/folders`,
    jsonInit('POST', input),
    profile,
  )
}

export function removeProjectFolder(
  idOrSlug: string,
  path: string,
  profile?: string,
): Promise<ProjectDetailResponse> {
  return mutateProject<ProjectDetailResponse>(
    `${BASE}/${encodeURIComponent(idOrSlug)}/folders`,
    jsonInit('DELETE', { path }),
    profile,
  )
}

export function setPrimaryProjectFolder(
  idOrSlug: string,
  path: string,
  profile?: string,
): Promise<ProjectDetailResponse> {
  return mutateProject<ProjectDetailResponse>(
    `${BASE}/${encodeURIComponent(idOrSlug)}/folders/primary`,
    jsonInit('POST', { path }),
    profile,
  )
}

export function archiveProject(
  idOrSlug: string,
  profile?: string,
): Promise<ProjectDetailResponse> {
  return mutateProject<ProjectDetailResponse>(
    `${BASE}/${encodeURIComponent(idOrSlug)}/archive`,
    jsonInit('POST'),
    profile,
  )
}

export function restoreProject(
  idOrSlug: string,
  profile?: string,
): Promise<ProjectDetailResponse> {
  return mutateProject<ProjectDetailResponse>(
    `${BASE}/${encodeURIComponent(idOrSlug)}/restore`,
    jsonInit('POST'),
    profile,
  )
}

export function setActiveProject(
  idOrSlug: string,
  profile?: string,
): Promise<ProjectsListResponse> {
  return mutateProject<ProjectsListResponse>(
    `${BASE}/${encodeURIComponent(idOrSlug)}/active`,
    jsonInit('POST'),
    profile,
  )
}

export function resolveSessionProject(
  sessionId: string,
  profile?: string,
): Promise<SessionProjectResolution> {
  return projectsFetch<SessionProjectResolution>(
    `${BASE}/session/${encodeURIComponent(sessionId)}`,
    {},
    profile,
  )
}

export function bindSessionProject(
  sessionId: string,
  projectSlug: string,
  profile?: string,
): Promise<SessionProjectBindingResponse> {
  return mutateProject<SessionProjectBindingResponse>(
    `${BASE}/session?session_id=${encodeURIComponent(sessionId)}`,
    jsonInit('POST', { project_slug: projectSlug, bound_by: 'switchui' }),
    profile,
  )
}

export function unbindSessionProject(
  sessionId: string,
  profile?: string,
): Promise<SessionProjectUnbindResponse> {
  return mutateProject<SessionProjectUnbindResponse>(
    `${BASE}/session/${encodeURIComponent(sessionId)}`,
    jsonInit('DELETE'),
    profile,
  )
}

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
  sessions: Record<string, string>
}

export type SessionProjectMapResult =
  | { notModified: true; etag: string | null }
  | { notModified: false; etag: string | null; map: SessionProjectMap }

const PROJECT_MAP_PATH = '/api/plugins/hermes-switch-ui/project-map'

/**
 * Session→project map for sidebar folders. Prefers the hermes-switch-ui
 * plugin's one-shot `/project-map` (ETag/304); when that route 404s (dashboard
 * not restarted / plugin older) falls back to the projects plugin: list +
 * one `/{id}/sessions` call per project (no ETag).
 */
export async function getSessionProjectMap(
  profile?: string,
  ifNoneMatch?: string,
): Promise<SessionProjectMapResult> {
  const scope = profile || getActiveProfileName()
  const res = await dashboardFetch(
    `${PROJECT_MAP_PATH}?profile=${encodeURIComponent(scope)}`,
    {
      headers: ifNoneMatch ? { 'If-None-Match': ifNoneMatch } : undefined,
      signal: AbortSignal.timeout(PROJECTS_FETCH_TIMEOUT_MS),
    },
  )
  const etag = res.headers.get('etag')
  if (res.status === 304) return { notModified: true, etag }
  if (res.ok) {
    return {
      notModified: false,
      etag,
      map: (await res.json()) as SessionProjectMap,
    }
  }
  if (res.status !== 404) {
    throw new Error(`Projects API error ${res.status}: project-map failed`)
  }

  // ponytail: N+1 fallback; goes away once every dashboard serves /project-map.
  const { projects } = await listProjects(true, scope)
  const bindings = await Promise.all(
    projects.map((p) =>
      projectsFetch<{ bindings: Array<{ session_id: string }> }>(
        `${BASE}/${encodeURIComponent(p.id)}/sessions`,
        {},
        scope,
      ),
    ),
  )
  const sessions: Record<string, string> = {}
  projects.forEach((p, i) => {
    for (const b of bindings[i].bindings) sessions[b.session_id] = p.id
  })
  return {
    notModified: false,
    etag: null,
    map: {
      version: null,
      projects: projects.map((p) => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        icon: p.icon,
        color: p.color,
        archived: p.archived,
        board_slug: p.board_slug,
      })),
      sessions,
    },
  }
}

export function deleteProject(
  idOrSlug: string,
  profile?: string,
): Promise<ProjectsListResponse> {
  return mutateProject<ProjectsListResponse>(
    `${BASE}/${encodeURIComponent(idOrSlug)}`,
    jsonInit('DELETE'),
    profile,
  )
}
