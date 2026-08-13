import { useQuery } from '@tanstack/react-query'
import type { NormalizedToolset } from './toolsets'

/**
 * Client access to `GET /api/profiles/toolsets` — the one place that knows how
 * to reach the gateway's `/v1/toolsets` registry and how to fall back when it
 * cannot.
 *
 * `source` is load-bearing, not decoration: `'gateway'` means the rows reflect
 * the gateway's live resolution (including `agent.disabled_toolsets`), while
 * `'static'` means the route could not reach the gateway and answered from the
 * in-tree catalog. A `'static'` payload therefore carries no `gatewayEnabled`
 * on any row and must never be rendered as live state — see
 * `isToolsetSuppressed()` in `lib/toolsets.ts`.
 */
export type ToolsetCatalog = {
  toolsets: Array<NormalizedToolset>
  source: 'gateway' | 'static'
}

/** Shared so the profile wizard and the Toolsets screen hit one cache entry. */
export const TOOLSET_CATALOG_QUERY_KEY = ['toolsets', 'catalog'] as const

export async function fetchToolsetCatalog(): Promise<ToolsetCatalog> {
  const r = await fetch('/api/profiles/toolsets')
  if (!r.ok) throw new Error(`toolsets ${r.status}`)
  return (await r.json()) as ToolsetCatalog
}

export function useToolsetCatalog() {
  return useQuery({
    queryKey: TOOLSET_CATALOG_QUERY_KEY,
    queryFn: fetchToolsetCatalog,
    staleTime: 60_000,
  })
}
