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

export const projectsKeys = {
  all: ['hermes-projects'] as const,
  list: (includeArchived: boolean) =>
    ['hermes-projects', 'list', { includeArchived }] as const,
  detail: (idOrSlug: string) =>
    ['hermes-projects', 'detail', idOrSlug] as const,
  folders: (idOrSlug: string) =>
    ['hermes-projects', 'folders', idOrSlug] as const,
  activity: (idOrSlug: string) =>
    ['hermes-projects', 'activity', idOrSlug] as const,
  session: (sessionKey: string) =>
    ['hermes-projects', 'session', sessionKey] as const,
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
): Promise<ProjectMutationResponse> {
  return projectsJson<ProjectMutationResponse>('/api/hermes-projects', {
    ...jsonBody(input),
  })
}

export function updateProject(
  idOrSlug: string,
  input: UpdateProjectInput,
): Promise<ProjectMutationResponse> {
  return projectsJson<ProjectMutationResponse>(projectPath(idOrSlug), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export function addProjectFolder(
  idOrSlug: string,
  input: AddProjectFolderInput,
): Promise<ProjectMutationResponse> {
  return projectsJson<ProjectMutationResponse>(
    `${projectPath(idOrSlug)}/folders`,
    jsonBody(input),
  )
}

export function removeProjectFolder(
  idOrSlug: string,
  path: string,
): Promise<ProjectMutationResponse> {
  return projectsJson<ProjectMutationResponse>(
    `${projectPath(idOrSlug)}/folders`,
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
): Promise<ProjectMutationResponse> {
  return projectsJson<ProjectMutationResponse>(
    `${projectPath(idOrSlug)}/folders/primary`,
    jsonBody({ path }),
  )
}

export function archiveProject(
  idOrSlug: string,
): Promise<ProjectMutationResponse> {
  return projectsJson<ProjectMutationResponse>(
    `${projectPath(idOrSlug)}/archive`,
    jsonBody({}),
  )
}

export function restoreProject(
  idOrSlug: string,
): Promise<ProjectMutationResponse> {
  return projectsJson<ProjectMutationResponse>(
    `${projectPath(idOrSlug)}/restore`,
    jsonBody({}),
  )
}

export function setActiveProject(
  idOrSlug: string,
): Promise<ProjectsListResponse> {
  return projectsJson<ProjectsListResponse>(
    `${projectPath(idOrSlug)}/active`,
    jsonBody({}),
  )
}

export function deleteProject(idOrSlug: string): Promise<ProjectsListResponse> {
  return projectsJson<ProjectsListResponse>(projectPath(idOrSlug), {
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

export function useCreateProject() {
  return useProjectMutation(createProject)
}
export function useUpdateProject() {
  return useProjectMutation(
    ({ idOrSlug, input }: { idOrSlug: string; input: UpdateProjectInput }) =>
      updateProject(idOrSlug, input),
  )
}
export function useAddProjectFolder() {
  return useProjectMutation(
    ({ idOrSlug, input }: { idOrSlug: string; input: AddProjectFolderInput }) =>
      addProjectFolder(idOrSlug, input),
  )
}
export function useRemoveProjectFolder() {
  return useProjectMutation(
    ({ idOrSlug, path }: { idOrSlug: string; path: string }) =>
      removeProjectFolder(idOrSlug, path),
  )
}
export function useSetPrimaryProjectFolder() {
  return useProjectMutation(
    ({ idOrSlug, path }: { idOrSlug: string; path: string }) =>
      setPrimaryProjectFolder(idOrSlug, path),
  )
}
export function useArchiveProject() {
  return useProjectMutation(archiveProject)
}
export function useRestoreProject() {
  return useProjectMutation(restoreProject)
}
export function useSetActiveProject() {
  return useProjectMutation(setActiveProject)
}
export function useDeleteProject() {
  return useProjectMutation(deleteProject)
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

export function useSessionProject(sessionKey?: string) {
  return useQuery({
    queryKey: projectsKeys.session(sessionKey ?? ''),
    queryFn: () => fetchSessionProject(sessionKey!),
    enabled: Boolean(sessionKey),
    staleTime: 30_000,
  })
}
