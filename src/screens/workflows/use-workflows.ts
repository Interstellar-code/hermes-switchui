/**
 * TanStack Query hooks for the /workflows page.
 */
import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  approveWorkflowRun,
  cancelWorkflowRun,
  deleteWorkflowDefinition,
  getWorkflowDefinitionParsed,
  getWorkflowDefinitionVersion,
  getWorkflowFeatures,
  getWorkflowRun,
  launchWorkflowRun,
  listRunEvents,
  listRunEventsPaged,
  listWorkflowDefinitionVersions,
  listWorkflowDefinitions,
  listWorkflowRuns,
  resetWorkflowDefinitionToFactory,
  retryWorkflowRun,
  upsertWorkflowDefinition,
  validateWorkflowDefinition,
} from './api-client'
import type {
  ApproveWorkflowInput,
  LaunchWorkflowInput,
  RunEventsPage,
  RunEventsQuery,
  UpsertWorkflowDefinitionInput,
  WorkflowDefinitionRow,
} from './api-client'
import type { QueryClient } from '@tanstack/react-query'
import type { VersionTier, WorkflowSource, WorkflowSummary } from './types'

/** JSON-encoded tags column → string[]; never throws (shared by the detail page). */
export function parseTags(raw: string | null): Array<string> {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string')
      : []
  } catch {
    return []
  }
}

function adaptDefinition(row: WorkflowDefinitionRow): WorkflowSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    source: row.source,
    tags: parseTags(row.tags),
    node_count: row.node_count ?? 0,
    last_used_at: row.last_used_at != null ? String(row.last_used_at) : null,
    version_tier: 'v1',
    // Pass through enrichment fields added by summariseWorkflowYaml on the list route.
    // These were previously zeroed, hiding badge/input data from the UI.
    has_loop: row.has_loop ?? false,
    has_approval: row.has_approval ?? false,
    required_inputs: row.required_inputs ?? [],
    optional_inputs: row.optional_inputs ?? [],
    node_types: row.node_types ?? [],
    when_to_use: '',
    dag_depth: 0,
    max_parallelism: 0,
    run_count: row.run_count,
    dag: [],
    dag_edges: [],
    yaml: row.yaml,
    kind: row.kind,
    user_modified: row.user_modified,
    bundled_checksum: row.bundled_checksum,
    updated_at: row.updated_at,
    created_at: row.created_at,
    version: row.version ?? null,
  }
}

export function useWorkflowDefinitions() {
  return useQuery({
    queryKey: ['workflow-definitions'],
    queryFn: async () => {
      const rows = await listWorkflowDefinitions()
      return rows.map(adaptDefinition)
    },
    staleTime: 30_000,
  })
}

export function useWorkflowParsed(id: string | null) {
  return useQuery({
    queryKey: ['workflow-definitions', id, 'parsed'],
    queryFn: () => getWorkflowDefinitionParsed(id!),
    enabled: !!id,
    staleTime: 30_000,
  })
}

/** Sidebar badge cache (QA2 F1-9): every definitions write must refresh it. */
function invalidateNavWorkflowCount(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ['nav-count', 'workflows'] })
}

/** Snapshot history, newest first (feature `definition_versions`). */
export function useWorkflowDefinitionVersions(
  id: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['workflow-definitions', id, 'versions'],
    queryFn: () => listWorkflowDefinitionVersions(id!),
    enabled: !!id && enabled,
    staleTime: 30_000,
  })
}

/** One snapshot with its yaml — VIEW in the VERSIONS tab. */
export function useWorkflowDefinitionVersion(
  id: string | null,
  checksum: string | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['workflow-definitions', id, 'versions', checksum],
    queryFn: () => getWorkflowDefinitionVersion(id!, checksum!),
    enabled: !!id && !!checksum && enabled,
    staleTime: 60_000,
  })
}

export function useLaunchWorkflowRun() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: LaunchWorkflowInput) => launchWorkflowRun(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflow-definitions'] })
      void queryClient.invalidateQueries({ queryKey: ['workflow-runs'] })
    },
  })
}

export function useWorkflowRuns(workflowId: string | null) {
  return useQuery({
    queryKey: ['workflow-runs', 'workflow', workflowId],
    queryFn: () => listWorkflowRuns({ workflow_id: workflowId! }),
    enabled: !!workflowId,
    staleTime: 10_000,
  })
}

/** Re-runs launched from `runId` (RUN AGAIN lineage, feature `parent_run`). */
export function useChildRuns(runId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['workflow-runs', 'children', runId],
    queryFn: () => listWorkflowRuns({ parent_run_id: runId!, limit: 20 }),
    enabled: !!runId && enabled,
    staleTime: 10_000,
  })
}

export function useRunEvents(
  runId: string | null,
  q: RunEventsQuery = {},
  /** pageAll: page forward from seq 0 (needs `events_query`). */
  opts: { enabled?: boolean; pageAll?: boolean } = {},
) {
  const pageAll = opts.pageAll ?? false
  return useQuery({
    queryKey: ['workflow-run-events', runId, q, pageAll],
    queryFn: (): Promise<(RunEventsPage & { complete?: boolean }) | null> =>
      pageAll ? listRunEventsPaged(runId!, q) : listRunEvents(runId!, q),
    enabled: !!runId && (opts.enabled ?? true),
    staleTime: 10_000,
  })
}

export function useWorkflowFeatures() {
  return useQuery({
    queryKey: ['workflow-features'],
    queryFn: getWorkflowFeatures,
    staleTime: 5 * 60_000,
  })
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled'])

export function useWorkflowRun(runId: string | null) {
  return useQuery({
    queryKey: ['workflow-runs', runId],
    queryFn: () => getWorkflowRun(runId!),
    enabled: !!runId,
    staleTime: 0,
    refetchInterval: (query) => {
      const status = query.state.data?.run.status
      if (!status) return 2_000
      return TERMINAL_STATUSES.has(status) ? false : 2_000
    },
  })
}

export function useCancelRun(runId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => cancelWorkflowRun(runId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflow-runs', runId] })
    },
  })
}

export function useApproveRun(runId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ApproveWorkflowInput) =>
      approveWorkflowRun(runId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflow-runs', runId] })
    },
  })
}

/**
 * Resume a failed/cancelled run in place. A lost race ("already retried")
 * resolves as success: the run is being retried either way.
 */
export function useRetryRun() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['retry-run'],
    mutationFn: async (v: { runId: string; fromNodeId?: string }) => {
      try {
        await retryWorkflowRun(
          v.runId,
          v.fromNodeId ? { from_node_id: v.fromNodeId } : {},
        )
      } catch (e) {
        if ((e as { code?: string }).code !== 'already_retried') throw e
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflow-runs'] })
      void queryClient.invalidateQueries({ queryKey: ['workflow-run-events'] })
      void queryClient.invalidateQueries({ queryKey: ['conductor'] })
    },
  })
}

/** A retry of `runId` is in flight from any RESUME button. */
export function useRetryPending(runId: string | null) {
  return (
    useMutationState({
      filters: {
        mutationKey: ['retry-run'],
        status: 'pending',
        predicate: (m) =>
          (m.state.variables as { runId?: string } | undefined)?.runId ===
          runId,
      },
    }).length > 0
  )
}

export function useUpsertWorkflowDefinition() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpsertWorkflowDefinitionInput) =>
      upsertWorkflowDefinition(input),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['workflow-definitions'] })
      void queryClient.invalidateQueries({
        queryKey: ['workflow-definitions', data.definition.id, 'parsed'],
      })
      void queryClient.invalidateQueries({
        queryKey: ['workflow-definitions', data.definition.id, 'versions'],
      })
      invalidateNavWorkflowCount(queryClient)
    },
  })
}

export function useResetWorkflowDefinitionToFactory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => resetWorkflowDefinitionToFactory(id),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['workflow-definitions'] })
      void queryClient.invalidateQueries({
        queryKey: ['workflow-definitions', data.definition.id, 'parsed'],
      })
      void queryClient.invalidateQueries({
        queryKey: ['workflow-definitions', data.definition.id, 'versions'],
      })
      invalidateNavWorkflowCount(queryClient)
    },
  })
}

export function useDeleteWorkflowDefinition() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteWorkflowDefinition(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflow-definitions'] })
      invalidateNavWorkflowCount(queryClient)
    },
  })
}

export function useValidateWorkflowDefinition(
  yaml: string | null | undefined,
  id?: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ['workflow-definition-validate', id ?? 'no-id', yaml],
    queryFn: () => validateWorkflowDefinition(yaml!, id),
    enabled: Boolean(yaml) && (options?.enabled ?? true),
    staleTime: 60_000,
  })
}
