import { useQuery } from '@tanstack/react-query'
import type {
  ProjectActivityResponse,
  ProjectDetailResponse,
  ProjectFoldersResponse,
  ProjectsListResponse,
} from './projects-types'

async function projectsJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string
      detail?: string
    }
    throw new Error(
      body.error ?? body.detail ?? `Request failed: ${res.status}`,
    )
  }
  return res.json() as Promise<T>
}

export const projectsKeys = {
  all: ['hermes-projects'] as const,
  list: (includeArchived: boolean) =>
    ['hermes-projects', 'list', { includeArchived }] as const,
  detail: (idOrSlug: string) => ['hermes-projects', 'detail', idOrSlug] as const,
  folders: (idOrSlug: string) =>
    ['hermes-projects', 'folders', idOrSlug] as const,
  activity: (idOrSlug: string) =>
    ['hermes-projects', 'activity', idOrSlug] as const,
}

export async function fetchProjects(
  includeArchived = false,
): Promise<ProjectsListResponse> {
  const q = new URLSearchParams()
  if (includeArchived) q.set('include_archived', 'true')
  const qs = q.toString()
  return projectsJson<ProjectsListResponse>(
    `/api/hermes-projects${qs ? `?${qs}` : ''}`,
  )
}

export async function fetchProject(
  idOrSlug: string,
): Promise<ProjectDetailResponse> {
  return projectsJson<ProjectDetailResponse>(
    `/api/hermes-projects/${encodeURIComponent(idOrSlug)}`,
  )
}

export async function fetchProjectFolders(
  idOrSlug: string,
): Promise<ProjectFoldersResponse> {
  return projectsJson<ProjectFoldersResponse>(
    `/api/hermes-projects/${encodeURIComponent(idOrSlug)}/folders`,
  )
}

export async function fetchProjectActivity(
  idOrSlug: string,
  opts?: { limit?: number; cursor?: string | null },
): Promise<ProjectActivityResponse> {
  const q = new URLSearchParams()
  if (opts?.limit != null) q.set('limit', String(opts.limit))
  if (opts?.cursor != null) q.set('cursor', opts.cursor)
  const qs = q.toString()
  return projectsJson<ProjectActivityResponse>(
    `/api/hermes-projects/${encodeURIComponent(idOrSlug)}/activity${qs ? `?${qs}` : ''}`,
  )
}

export function useProjects(includeArchived = false, enabled = true) {
  return useQuery({
    queryKey: projectsKeys.list(includeArchived),
    queryFn: () => fetchProjects(includeArchived),
    enabled,
  })
}

export function useProject(idOrSlug: string, enabled = true) {
  return useQuery({
    queryKey: projectsKeys.detail(idOrSlug),
    queryFn: () => fetchProject(idOrSlug),
    enabled: enabled && !!idOrSlug,
  })
}

export function useProjectFolders(idOrSlug: string, enabled = true) {
  return useQuery({
    queryKey: projectsKeys.folders(idOrSlug),
    queryFn: () => fetchProjectFolders(idOrSlug),
    enabled: enabled && !!idOrSlug,
  })
}

export function useProjectActivity(
  idOrSlug: string,
  opts?: { limit?: number; cursor?: string | null },
  enabled = true,
) {
  return useQuery({
    queryKey: projectsKeys.activity(idOrSlug),
    queryFn: () => fetchProjectActivity(idOrSlug, opts),
    enabled: enabled && !!idOrSlug,
  })
}
