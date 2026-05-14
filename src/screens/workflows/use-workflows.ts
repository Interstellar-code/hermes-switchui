/**
 * TanStack Query hooks for the /workflows page.
 *
 * B.4 Path A: only Library + Grid consume live data. Editor + Launch Wizard
 * continue using mock-workflows.ts (rich DagNode structure not exposed by the
 * backend yet — comes later via a parsed-YAML endpoint).
 *
 * Adapter: WorkflowDefinitionRow → MockWorkflow with safe defaults for fields
 * the backend doesn't surface (node_count=0, has_loop=false, run_count=0,
 * last_used_at=null, etc.). The Library + Grid render correctly with these
 * defaults; the Editor + Wizard fall back to mock data when picking a
 * specific id.
 */
import { useQuery } from '@tanstack/react-query'
import { listWorkflowDefinitions, type WorkflowDefinitionRow } from './api-client'
import type { MockWorkflow, VersionTier, WorkflowSource } from './mock-workflows'

function parseTags(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function adaptDefinition(row: WorkflowDefinitionRow): MockWorkflow {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    source: row.source as WorkflowSource,
    tags: parseTags(row.tags),
    node_count: 0,
    last_used_at: null,
    version_tier: 'v1' as VersionTier,
    has_loop: false,
    has_approval: false,
    required_inputs: [],
    optional_inputs: [],
    when_to_use: '',
    dag_depth: 0,
    max_parallelism: 0,
    run_count: 0,
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
