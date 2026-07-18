/**
 * Server-only client for the Hermes Agent Dashboard Projects plugin.
 *
 * All HTTP calls use dashboardFetch() from gateway-capabilities.ts — never
 * import this module in client-side code. Read-only v1: GET endpoints only.
 */
import { dashboardFetch } from './gateway-capabilities'
import type {
  ProjectDetailResponse,
  ProjectFoldersResponse,
  ProjectsListResponse,
} from '../lib/projects-types'

const BASE = '/api/plugins/projects'

// Mirrors KANBAN_FETCH_TIMEOUT_MS — must exceed the worst-case dashboardFetch
// auth flow (cold-cache 401 retry: two 3s HTML-scrape token fetches).
const PROJECTS_FETCH_TIMEOUT_MS = 12_000

async function projectsFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await dashboardFetch(path, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(PROJECTS_FETCH_TIMEOUT_MS),
  })
  if (!res.ok) {
    let detail = `Projects API error ${res.status}`
    try {
      const body = (await res.json()) as { detail?: string; error?: string }
      detail = body.detail ?? body.error ?? detail
    } catch {
      // ignore parse failure
    }
    throw new Error(`Projects API error ${res.status}: ${detail}`)
  }
  return res.json() as Promise<T>
}

export async function listProjects(
  includeArchived = false,
): Promise<ProjectsListResponse> {
  const q = new URLSearchParams()
  if (includeArchived) q.set('include_archived', 'true')
  const qs = q.toString()
  return projectsFetch<ProjectsListResponse>(
    `${BASE}${qs ? `?${qs}` : ''}`,
    {},
  )
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
