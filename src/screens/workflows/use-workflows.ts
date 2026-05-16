/**
 * TanStack Query hooks for the /workflows page.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  approveWorkflowRun,
  cancelWorkflowRun,
  deleteWorkflowDefinition,
  getWorkflowDefinitionParsed,
  getWorkflowRun,
  launchWorkflowRun,
  listWorkflowDefinitions,
  upsertWorkflowDefinition,
} from './api-client'
import type {
  ApproveWorkflowInput,
  LaunchWorkflowInput,
  UpsertWorkflowDefinitionInput,
  WorkflowDefinitionRow,
} from './api-client';
import type {VersionTier, WorkflowSource, WorkflowSummary} from './types';

function parseTags(raw: string | null): Array<string> {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function adaptDefinition(row: WorkflowDefinitionRow): WorkflowSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    source: row.source as WorkflowSource,
    tags: parseTags(row.tags),
    node_count: row.node_count,
    last_used_at: row.last_used_at != null ? String(row.last_used_at) : null,
    version_tier: 'v1' as VersionTier,
    has_loop: false,
    has_approval: false,
    required_inputs: [],
    optional_inputs: [],
    when_to_use: '',
    dag_depth: 0,
    max_parallelism: 0,
    run_count: row.run_count,
    dag: [],
    dag_edges: [],
    yaml: row.yaml,
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
    mutationFn: (input: ApproveWorkflowInput) => approveWorkflowRun(runId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflow-runs', runId] })
    },
  })
}

export function useUpsertWorkflowDefinition() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpsertWorkflowDefinitionInput) => upsertWorkflowDefinition(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflow-definitions'] })
    },
  })
}

export function useDeleteWorkflowDefinition() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteWorkflowDefinition(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflow-definitions'] })
    },
  })
}
