/**
 * use-providers.ts — the four provider data sources, plus the merge.
 *
 * Kept as separate queries rather than one fetch so each can cache and refetch
 * on its own cadence: liveness changes far more often than config does.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { buildProviderViews } from '../lib/build-provider-views'
import type {
  ClaudeConfigPayload,
  EnvPayload,
  LocalProvidersPayload,
  ModelsPayload,
  ProviderStatus,
  ProviderView,
} from '../lib/provider-view'
import { getEnv } from '@/lib/hermes-client'

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`${path} failed (${res.status})`)
  return (await res.json()) as T
}

export function useProviderConfig() {
  return useQuery({
    queryKey: ['providers', 'claude-config'],
    queryFn: () => getJson<ClaudeConfigPayload>('/api/claude-config'),
    staleTime: 15_000,
  })
}

export function useProviderModels() {
  return useQuery({
    queryKey: ['providers', 'models'],
    queryFn: () => getJson<ModelsPayload>('/api/models'),
    staleTime: 15_000,
  })
}

export function useLocalProviders() {
  return useQuery({
    queryKey: ['providers', 'local'],
    queryFn: () => getJson<LocalProvidersPayload>('/api/local-providers'),
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}

/**
 * `/api/env` goes through the dashboard proxy and is not always reachable.
 * It only enriches credential detection, so a failure must not break the
 * screen — hence retry: false and a swallowed error.
 */
export function useProviderEnv() {
  return useQuery({
    queryKey: ['providers', 'env'],
    queryFn: async (): Promise<EnvPayload> => {
      try {
        return await getEnv()
      } catch {
        return {}
      }
    },
    staleTime: 30_000,
    retry: false,
  })
}

export type ProviderCounts = {
  total: number
  byStatus: Record<ProviderStatus, number>
  byOrigin: Record<'hosted' | 'local', number>
  byAuth: Record<string, number>
  withModels: number
  modelsUnknown: number
  configured: number
  totalModels: number
}

function countBy(views: Array<ProviderView>): ProviderCounts {
  const counts: ProviderCounts = {
    total: views.length,
    byStatus: {
      active: 0,
      ready: 0,
      'needs-key': 0,
      offline: 0,
      available: 0,
    },
    byOrigin: { hosted: 0, local: 0 },
    byAuth: {},
    withModels: 0,
    modelsUnknown: 0,
    configured: 0,
    totalModels: 0,
  }

  for (const view of views) {
    counts.byStatus[view.status] += 1
    counts.byOrigin[view.origin] += 1
    counts.byAuth[view.authKind] = (counts.byAuth[view.authKind] ?? 0) + 1
    if (view.modelCount > 0) counts.withModels += 1
    if (view.modelsUnknown) counts.modelsUnknown += 1
    if (view.inConfig) counts.configured += 1
    counts.totalModels += view.modelCount
  }

  return counts
}

export function useProviders() {
  const config = useProviderConfig()
  const models = useProviderModels()
  const local = useLocalProviders()
  const env = useProviderEnv()

  const views = useMemo(
    () =>
      buildProviderViews({
        claudeConfig: config.data,
        models: models.data,
        localProviders: local.data,
        env: env.data,
      }),
    [config.data, models.data, local.data, env.data],
  )

  const counts = useMemo(() => countBy(views), [views])

  return {
    views,
    counts,
    activeProvider: views.find((view) => view.isActive) ?? null,
    // env is best-effort, so it does not gate the screen.
    isPending: config.isPending || models.isPending,
    error: config.error ?? models.error ?? null,
    refetch: () => {
      void config.refetch()
      void models.refetch()
      void local.refetch()
      void env.refetch()
    },
  }
}
