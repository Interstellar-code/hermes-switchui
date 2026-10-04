import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isPlaceholderSessionKey } from './projects-types'
import type {
  AddProjectFolderInput,
  CreateProjectInput,
  ProjectActivityResponse,
  ProjectDetailResponse,
  ProjectFoldersResponse,
  ProjectMutationResponse,
  ProjectsListResponse,
  SessionProjectBindingResponse,
  SessionProjectMap,
  SessionProjectResolution,
  SessionProjectUnbindResponse,
  UpdateProjectInput,
} from './projects-types'
import { runPool } from '@/lib/run-pool'

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
  /** Keyed by the browsed profile — the one bind/unbind write to. */
  session: (sessionKey: string, profile?: string) =>
    ['hermes-projects', 'session', sessionKey, { profile }] as const,
  sessionMapAll: ['hermes-projects', 'session-map'] as const,
  sessionMap: (profile?: string) =>
    ['hermes-projects', 'session-map', { profile }] as const,
  gitStatus: (profile?: string) =>
    ['hermes-projects', 'git-status', { profile }] as const,
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
    withProfile(
      `/api/hermes-projects/${encodeURIComponent(idOrSlug)}`,
      profile,
    ),
  )
}

export async function fetchProjectFolders(
  idOrSlug: string,
  profile?: string,
): Promise<ProjectFoldersResponse> {
  return projectsJson<ProjectFoldersResponse>(
    withProfile(
      `/api/hermes-projects/${encodeURIComponent(idOrSlug)}/folders`,
      profile,
    ),
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
    withProfile(
      `/api/hermes-projects/${encodeURIComponent(idOrSlug)}/activity${qs ? `?${qs}` : ''}`,
      profile,
    ),
  )
}

function sessionProjectPath(sessionKey: string): string {
  return `/api/hermes-projects/session?sessionKey=${encodeURIComponent(sessionKey)}`
}

export function fetchSessionProject(
  sessionKey: string,
  profile?: string,
): Promise<SessionProjectResolution> {
  if (isPlaceholderSessionKey(sessionKey))
    return Promise.resolve({
      session_id: sessionKey,
      project: null,
      source: null,
    })
  return projectsJson<SessionProjectResolution>(
    withProfile(sessionProjectPath(sessionKey), profile),
  )
}

export function bindSessionProject({
  sessionKey,
  projectSlug,
  profile,
}: {
  sessionKey: string
  projectSlug: string
  profile?: string
}): Promise<SessionProjectBindingResponse | null> {
  if (isPlaceholderSessionKey(sessionKey)) return Promise.resolve(null)
  return projectsJson<SessionProjectBindingResponse>(
    withProfile(sessionProjectPath(sessionKey), profile),
    jsonBody({ project_slug: projectSlug }),
  )
}

export function unbindSessionProject(
  sessionKey: string,
  profile?: string,
): Promise<SessionProjectUnbindResponse> {
  if (isPlaceholderSessionKey(sessionKey))
    return Promise.resolve({ session_id: sessionKey, removed: 0 })
  return projectsJson<SessionProjectUnbindResponse>(
    withProfile(sessionProjectPath(sessionKey), profile),
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
  return projectsJson<ProjectMutationResponse>(
    withProfile('/api/hermes-projects', profile),
    {
      ...jsonBody(input),
    },
  )
}

export function updateProject(
  idOrSlug: string,
  input: UpdateProjectInput,
  profile?: string,
): Promise<ProjectMutationResponse> {
  return projectsJson<ProjectMutationResponse>(
    withProfile(projectPath(idOrSlug), profile),
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
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

export function deleteProject(
  idOrSlug: string,
  profile?: string,
): Promise<ProjectsListResponse> {
  return projectsJson<ProjectsListResponse>(
    withProfile(projectPath(idOrSlug), profile),
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    },
  )
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
  return useProjectMutation((input: CreateProjectInput) =>
    createProject(input, profile),
  )
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
  return useProjectMutation((idOrSlug: string) =>
    archiveProject(idOrSlug, profile),
  )
}
export function useRestoreProject(profile?: string) {
  return useProjectMutation((idOrSlug: string) =>
    restoreProject(idOrSlug, profile),
  )
}
export function useSetActiveProject(profile?: string) {
  return useProjectMutation((idOrSlug: string) =>
    setActiveProject(idOrSlug, profile),
  )
}
export function useDeleteProject(profile?: string) {
  return useProjectMutation((idOrSlug: string) =>
    deleteProject(idOrSlug, profile),
  )
}

export function fetchSessionProjectMap(
  profile?: string,
): Promise<SessionProjectMap> {
  return projectsJson<SessionProjectMap>(
    withProfile('/api/session-folders', profile),
  )
}

export function useSessionProjectMap(profile?: string, enabled = true) {
  return useQuery({
    queryKey: projectsKeys.sessionMap(profile),
    queryFn: () => fetchSessionProjectMap(profile),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
}

type QueryClient = ReturnType<typeof useQueryClient>
type MapSnapshot = Array<
  [ReadonlyArray<unknown>, SessionProjectMap | undefined]
>

/**
 * Optimistically rewrite one session's binding in the profile's cached session
 * map (the one the sidebar reads via useSessionProjectMap(profile)).
 */
async function patchSessionMaps(
  queryClient: QueryClient,
  profile: string | undefined,
  sessionKey: string,
  projectSlug: string | null,
): Promise<MapSnapshot> {
  if (isPlaceholderSessionKey(sessionKey)) return []
  const queryKey = projectsKeys.sessionMap(profile)
  await queryClient.cancelQueries({ queryKey, exact: true })
  const snapshot = queryClient.getQueriesData<SessionProjectMap>({
    queryKey,
    exact: true,
  })
  queryClient.setQueriesData<SessionProjectMap>(
    { queryKey, exact: true },
    (map) => {
      if (!map) return map
      // An inherited chat has no binding to remove: it stays where it is.
      if (projectSlug === null && map.inherited?.[sessionKey]) return map
      const sessions = { ...map.sessions }
      const from = sessions[sessionKey] as string | undefined
      let to: string | undefined
      if (projectSlug === null) {
        delete sessions[sessionKey]
        // Unbind removes the owning ancestor's binding (see unbindTarget).
        const owner = map.binding_owner?.[sessionKey]
        if (owner) delete sessions[owner]
      } else {
        const project = map.projects.find((p) => p.slug === projectSlug)
        if (!project) return map
        to = sessions[sessionKey] = project.id
      }
      const next = { ...map, sessions }
      // Server folder counts follow the move (refetch settles exact numbers).
      if (map.counts && from !== to) {
        const counts = { ...map.counts }
        if (from) counts[from] = Math.max(0, (counts[from] ?? 0) - 1)
        if (to) counts[to] = (counts[to] ?? 0) + 1
        next.counts = counts
        if (map.unfiled !== undefined)
          next.unfiled = Math.max(
            0,
            map.unfiled + (from ? 0 : -1) + (to ? 0 : 1),
          )
      }
      if (map.inherited?.[sessionKey]) {
        // Now explicit (or unbound): no longer inherited.
        const { [sessionKey]: _, ...inherited } = map.inherited
        next.inherited = inherited
      }
      return next
    },
  )
  return snapshot
}

/**
 * The session whose binding to delete: a compressed continuation or inherited
 * chat has no binding of its own — its folder belongs to `binding_owner`.
 */
function unbindTarget(
  queryClient: QueryClient,
  profile: string | undefined,
  sessionKey: string,
): string {
  const map = queryClient.getQueryData<SessionProjectMap>(
    projectsKeys.sessionMap(profile),
  )
  if (!map || map.inherited?.[sessionKey]) return sessionKey
  return map.binding_owner?.[sessionKey] ?? sessionKey
}

function rollbackSessionMaps(queryClient: QueryClient, snapshot?: MapSnapshot) {
  for (const [key, data] of snapshot ?? []) queryClient.setQueryData(key, data)
}

function settleSessionProject(
  queryClient: QueryClient,
  sessionKey: string,
  profile?: string,
) {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: projectsKeys.session(sessionKey, profile),
    }),
    queryClient.invalidateQueries({ queryKey: projectsKeys.sessionMapAll }),
  ])
}

export function useBindSessionProject(profile?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { sessionKey: string; projectSlug: string }) =>
      bindSessionProject({ ...input, profile }),
    onMutate: ({ sessionKey, projectSlug }) =>
      patchSessionMaps(queryClient, profile, sessionKey, projectSlug),
    onError: (_err, _input, snapshot) =>
      rollbackSessionMaps(queryClient, snapshot),
    onSettled: (_data, _err, { sessionKey }) =>
      settleSessionProject(queryClient, sessionKey, profile),
  })
}

export function useUnbindSessionProject(profile?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (sessionKey: string) =>
      unbindSessionProject(
        unbindTarget(queryClient, profile, sessionKey),
        profile,
      ),
    onMutate: (sessionKey) =>
      patchSessionMaps(queryClient, profile, sessionKey, null),
    onError: (_err, _sessionKey, snapshot) =>
      rollbackSessionMaps(queryClient, snapshot),
    onSettled: (_data, _err, sessionKey) =>
      settleSessionProject(queryClient, sessionKey, profile),
  })
}

/**
 * Move many sessions at once (`projectSlug: null` = remove from project).
 * Optimistic map patch up front, ≤4 requests in flight, ONE invalidate at the
 * end. Resolves with the session keys that failed (rolled back via refetch)
 * and, for a remove, the inherited keys skipped (they have no binding to
 * delete; only picking a folder overrides inheritance).
 */
export function useBulkMoveSessions(profile?: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      sessionKeys,
      projectSlug,
    }: {
      sessionKeys: Array<string>
      projectSlug: string | null
    }): Promise<{ failed: Array<string>; inherited: Array<string> }> => {
      const map = queryClient.getQueryData<SessionProjectMap>(
        projectsKeys.sessionMap(profile),
      )
      const inherited =
        projectSlug === null
          ? sessionKeys.filter((key) => map?.inherited?.[key])
          : []
      const keys = sessionKeys.filter((key) => !inherited.includes(key))
      // Remove targets the binding owner; siblings sharing one → one DELETE.
      const targetOf = new Map(
        keys.map((key) => [
          key,
          projectSlug === null ? unbindTarget(queryClient, profile, key) : key,
        ]),
      )
      for (const key of keys)
        await patchSessionMaps(queryClient, profile, key, projectSlug)
      const targets = [...new Set(targetOf.values())]
      const results = await runPool<string, unknown>(targets, 4, (target) =>
        projectSlug === null
          ? unbindSessionProject(target, profile)
          : bindSessionProject({ sessionKey: target, projectSlug, profile }),
      )
      const failedTargets = new Set(
        targets.filter((_, i) => results[i].status === 'rejected'),
      )
      const failed = keys.filter((key) => failedTargets.has(targetOf.get(key)!))
      return { failed, inherited }
    },
    onSettled: async () => {
      // A map refetch that started mid-move would land stale bindings over
      // the final state — drop it before the one invalidate.
      await queryClient.cancelQueries({
        queryKey: projectsKeys.sessionMap(profile),
      })
      await queryClient.invalidateQueries({ queryKey: projectsKeys.all })
    },
  })
}

export function useProjects(
  includeArchived = false,
  enabled = true,
  profile?: string,
) {
  return useQuery({
    queryKey: projectsKeys.list(includeArchived, profile),
    queryFn: () => fetchProjects(includeArchived, profile),
    enabled,
  })
}

/** project id → whether its folder paths are a git checkout (+ branch). */
export function useProjectGitStatus(profile?: string, enabled = true) {
  return useQuery({
    queryKey: projectsKeys.gitStatus(profile),
    queryFn: () =>
      projectsJson<Record<string, { git: boolean; branch?: string }>>(
        withProfile('/api/hermes-projects/git-status', profile),
      ),
    enabled,
    staleTime: 60_000,
  })
}

export function useProject(idOrSlug: string, enabled = true, profile?: string) {
  return useQuery({
    queryKey: projectsKeys.detail(idOrSlug, profile),
    queryFn: () => fetchProject(idOrSlug, profile),
    enabled: enabled && !!idOrSlug,
  })
}

export function useProjectFolders(
  idOrSlug: string,
  enabled = true,
  profile?: string,
) {
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

export function useSessionProject(sessionKey?: string, profile?: string) {
  return useQuery({
    queryKey: projectsKeys.session(sessionKey ?? '', profile),
    queryFn: () => fetchSessionProject(sessionKey!, profile),
    enabled: Boolean(sessionKey) && !isPlaceholderSessionKey(sessionKey ?? ''),
    staleTime: 30_000,
  })
}
