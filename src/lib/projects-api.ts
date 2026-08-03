import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AddProjectFolderInput,
  CreateProjectInput,
  ProjectActivityResponse,
  ProjectDetailResponse,
  ProjectFoldersResponse,
  ProjectMutationResponse,
  ProjectsListResponse,
  SessionProjectBindingResponse,
  SessionProjectResolution,
  SessionProjectUnbindResponse,
  UpdateProjectInput,
} from './projects-types'
import { activeScopeKey } from '@/lib/session-scope'

async function projectsJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: unknown
      detail?: unknown
    }
    const detail = body.detail ?? body.error
    throw new Error(
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail
              .flatMap((item) =>
                item && typeof item === 'object' && typeof item.msg === 'string'
                  ? [item.msg]
                  : [],
              )
              .join('; ') || `Request failed: ${res.status}`
          : `Request failed: ${res.status}`,
    )
  }
  return res.json() as Promise<T>
}

function jsonBody(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

function projectPath(idOrSlug: string): string {
  return `/api/hermes-projects/${encodeURIComponent(idOrSlug)}`
}

function withProfile(path: string, profile?: string): string {
  if (!profile) return path
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}profile=${encodeURIComponent(profile)}`
}

export const projectsKeys = {
  all: ['hermes-projects'] as const,
  list: (includeArchived: boolean, profile?: string) =>
    ['hermes-projects', 'list', { includeArchived, profile }] as const,
  detail: (idOrSlug: string, profile?: string) =>
    ['hermes-projects', 'detail', idOrSlug, { profile }] as const,
  folders: (idOrSlug: string, profile?: string) =>
    ['hermes-projects', 'folders', idOrSlug, { profile }] as const,
  activity: (idOrSlug: string, profile?: string) =>
    ['hermes-projects', 'activity', idOrSlug, { profile }] as const,
  session: (sessionKey: string) =>
    ['hermes-projects', 'session', activeScopeKey(sessionKey)] as const,
}

export async function fetchProjects(
  includeArchived = false,
  profile?: string,
): Promise<ProjectsListResponse> {
  const q = new URLSearchParams()
  if (includeArchived) q.set('include_archived', 'true')
  if (profile) q.set('profile', profile)
  const qs = q.toString()
  return projectsJson<ProjectsListResponse>(
    `/api/hermes-projects${qs ? `?${qs}` : ''}`,
  )
}

export async function fetchProject(
  idOrSlug: string,
  profile?: string,
): Promise<ProjectDetailResponse> {
  return projectsJson<ProjectDetailResponse>(
    withProfile(`/api/hermes-projects/${encodeURIComponent(idOrSlug)}`, profile),
  )
}

export async function fetchProjectFolders(
  idOrSlug: string,
  profile?: string,
): Promise<ProjectFoldersResponse> {
  return projectsJson<ProjectFoldersResponse>(
    withProfile(`/api/hermes-projects/${encodeURIComponent(idOrSlug)}/folders`, profile),
  )
}

export async function fetchProjectActivity(
  idOrSlug: string,
  opts?: { limit?: number; cursor?: string | null },
  profile?: string,
): Promise<ProjectActivityResponse> {
  const q = new URLSearchParams()
  if (opts?.limit != null) q.set('limit', String(opts.limit))
  if (opts?.cursor != null) q.set('cursor', opts.cursor)
  const qs = q.toString()
  return projectsJson<ProjectActivityResponse>(
    withProfile(`/api/hermes-projects/${encodeURIComponent(idOrSlug)}/activity${qs ? `?${qs}` : ''}`, profile),
  )
}

function sessionProjectPath(sessionKey: string): string {
  return `/api/hermes-projects/session?sessionKey=${encodeURIComponent(sessionKey)}`
}

export function fetchSessionProject(
  sessionKey: string,
): Promise<SessionProjectResolution> {
  return projectsJson<SessionProjectResolution>(sessionProjectPath(sessionKey))
}

export function bindSessionProject({
  sessionKey,
  projectSlug,
}: {
  sessionKey: string
  projectSlug: string
}): Promise<SessionProjectBindingResponse> {
  return projectsJson<SessionProjectBindingResponse>(
    sessionProjectPath(sessionKey),
    jsonBody({ project_slug: projectSlug }),
  )
}

export function unbindSessionProject(
  sessionKey: string,
): Promise<SessionProjectUnbindResponse> {
  return projectsJson<SessionProjectUnbindResponse>(
    sessionProjectPath(sessionKey),
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    },
  )
}

export function createProject(
  input: CreateProjectInput,
  profile?: string,
): Promise<ProjectMutationResponse> {
  return projectsJson<ProjectMutationResponse>(withProfile('/api/hermes-projects', profile), {
    ...jsonBody(input),
  })
}

export function updateProject(
  idOrSlug: string,
  input: UpdateProjectInput,
  profile?: string,
): Promise<ProjectMutationResponse> {
  return projectsJson<ProjectMutationResponse>(withProfile(projectPath(idOrSlug), profile), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function addProjectFolder(
  idOrSlug: string,
  input: AddProjectFolderInput,
  profile?: string,
): Promise<ProjectMutationResponse> {
  return projectsJson<ProjectMutationResponse>(
    withProfile(`${projectPath(idOrSlug)}/folders`, profile),
    jsonBody(input),
  )
}

export function removeProjectFolder(
  idOrSlug: string,
  path: string,
  profile?: string,
): Promise<ProjectMutationResponse> {
  return projectsJson<ProjectMutationResponse>(
    withProfile(`${projectPath(idOrSlug)}/folders`, profile),
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    },
  )
}

export function setPrimaryProjectFolder(
  idOrSlug: string,
  path: string,
  profile?: string,
): Promise<ProjectMutationResponse> {
  return projectsJson<ProjectMutationResponse>(
    withProfile(`${projectPath(idOrSlug)}/folders/primary`, profile),
    jsonBody({ path }),
  )
}

export function archiveProject(
  idOrSlug: string,
  profile?: string,
): Promise<ProjectMutationResponse> {
  return projectsJson<ProjectMutationResponse>(
    withProfile(`${projectPath(idOrSlug)}/archive`, profile),
    jsonBody({}),
  )
}

export function restoreProject(
  idOrSlug: string,
  profile?: string,
): Promise<ProjectMutationResponse> {
  return projectsJson<ProjectMutationResponse>(
    withProfile(`${projectPath(idOrSlug)}/restore`, profile),
    jsonBody({}),
  )
}

export function setActiveProject(
  idOrSlug: string,
  profile?: string,
): Promise<ProjectsListResponse> {
  return projectsJson<ProjectsListResponse>(
    withProfile(`${projectPath(idOrSlug)}/active`, profile),
    jsonBody({}),
  )
}

export function deleteProject(idOrSlug: string, profile?: string): Promise<ProjectsListResponse> {
  return projectsJson<ProjectsListResponse>(withProfile(projectPath(idOrSlug), profile), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  })
}

export function invalidateProjectQueries(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  void queryClient.invalidateQueries({ queryKey: projectsKeys.all })
}

export function useProjectMutation<TInput>(
  mutationFn: (input: TInput) => Promise<unknown>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => invalidateProjectQueries(queryClient),
  })
}

export function useCreateProject(profile?: string) {
  return useProjectMutation((input: CreateProjectInput) => createProject(input, profile))
}
export function useUpdateProject(profile?: string) {
  return useProjectMutation(
    ({ idOrSlug, input }: { idOrSlug: string; input: UpdateProjectInput }) =>
      updateProject(idOrSlug, input, profile),
  )
}
export function useAddProjectFolder(profile?: string) {
  return useProjectMutation(
    ({ idOrSlug, input }: { idOrSlug: string; input: AddProjectFolderInput }) =>
      addProjectFolder(idOrSlug, input, profile),
  )
}
export function useRemoveProjectFolder(profile?: string) {
  return useProjectMutation(
    ({ idOrSlug, path }: { idOrSlug: string; path: string }) =>
      removeProjectFolder(idOrSlug, path, profile),
  )
}
export function useSetPrimaryProjectFolder(profile?: string) {
  return useProjectMutation(
    ({ idOrSlug, path }: { idOrSlug: string; path: string }) =>
      setPrimaryProjectFolder(idOrSlug, path, profile),
  )
}
export function useArchiveProject(profile?: string) {
  return useProjectMutation((idOrSlug: string) => archiveProject(idOrSlug, profile))
}
export function useRestoreProject(profile?: string) {
  return useProjectMutation((idOrSlug: string) => restoreProject(idOrSlug, profile))
}
export function useSetActiveProject(profile?: string) {
  return useProjectMutation((idOrSlug: string) => setActiveProject(idOrSlug, profile))
}
export function useDeleteProject(profile?: string) {
  return useProjectMutation((idOrSlug: string) => deleteProject(idOrSlug, profile))
}

function invalidateSessionProjectQuery(
  queryClient: ReturnType<typeof useQueryClient>,
  sessionKey: string,
) {
  return queryClient.invalidateQueries({
    queryKey: projectsKeys.session(sessionKey),
  })
}

export function useBindSessionProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: bindSessionProject,
    onSuccess: (_, { sessionKey }) =>
      invalidateSessionProjectQuery(queryClient, sessionKey),
  })
}

export function useUnbindSessionProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: unbindSessionProject,
    onSuccess: (_, sessionKey) =>
      invalidateSessionProjectQuery(queryClient, sessionKey),
  })
}

export function useProjects(includeArchived = false, enabled = true, profile?: string) {
  return useQuery({
    queryKey: projectsKeys.list(includeArchived, profile),
    queryFn: () => fetchProjects(includeArchived, profile),
    enabled,
  })
}

export function useProject(idOrSlug: string, enabled = true, profile?: string) {
  return useQuery({
    queryKey: projectsKeys.detail(idOrSlug, profile),
    queryFn: () => fetchProject(idOrSlug, profile),
    enabled: enabled && !!idOrSlug,
  })
}

export function useProjectFolders(idOrSlug: string, enabled = true, profile?: string) {
  return useQuery({
    queryKey: projectsKeys.folders(idOrSlug, profile),
    queryFn: () => fetchProjectFolders(idOrSlug, profile),
    enabled: enabled && !!idOrSlug,
  })
}

export function useProjectActivity(
  idOrSlug: string,
  opts?: { limit?: number; cursor?: string | null },
  enabled = true,
  profile?: string,
) {
  return useQuery({
    queryKey: projectsKeys.activity(idOrSlug, profile),
    queryFn: () => fetchProjectActivity(idOrSlug, opts, profile),
    enabled: enabled && !!idOrSlug,
  })
}

export function useSessionProject(sessionKey?: string) {
  return useQuery({
    queryKey: projectsKeys.session(sessionKey ?? ''),
    queryFn: () => fetchSessionProject(sessionKey!),
    enabled: Boolean(sessionKey),
    staleTime: 30_000,
  })
}
