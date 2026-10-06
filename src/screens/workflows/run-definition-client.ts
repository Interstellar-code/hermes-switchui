/**
 * Pinned run definition (backend feature `definition_pin`, GET /runs/{id}/definition).
 * `available: false` = the backend lacks the endpoint or the run is unknown.
 */
import { useQuery } from '@tanstack/react-query'
import type { ParsedWorkflow } from './types'

export interface RunDefinition {
  workflow_id: string
  checksum: string | null
  version: string | number | null
  yaml: string
  source: 'snapshot' | 'current'
  pinned: boolean
  current_checksum: string | null
  current_updated_at: number | string | null
  /** {subgraph ref: checksum} pinned at run start; absent on older plugins. */
  subgraphs_pinned?: Record<string, string>
}

export type RunDefinitionResponse =
  | { available: false }
  | {
      available: true
      definition: RunDefinition
      /** Projected from the pinned yaml server-side; null when it won't parse. */
      parsed: ParsedWorkflow | null
    }

export async function getRunDefinition(
  runId: string,
): Promise<RunDefinitionResponse> {
  const res = await fetch(
    `/api/workflow-runs/${encodeURIComponent(runId)}/definition`,
  )
  if (res.status === 404) return { available: false }
  if (!res.ok) throw new Error(`getRunDefinition failed (${res.status})`)
  return (await res.json()) as RunDefinitionResponse
}

export function useRunDefinition(runId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['workflow-run-definition', runId],
    queryFn: () => getRunDefinition(runId!),
    enabled: !!runId && enabled,
    staleTime: 60_000,
  })
}
