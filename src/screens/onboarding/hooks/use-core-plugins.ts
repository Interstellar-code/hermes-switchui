'use client'

/**
 * use-core-plugins.ts — the plugins step's data + write layer.
 *
 * Reads the Plugins Hub through `getPluginsHub()` (the browser-safe
 * projection in `@/lib/hermes-client` — never `src/server/hermes-api.ts`,
 * which is Node-only) and folds it through `buildCorePluginRows` so the step
 * only ever sees the curated Interstellar set. A failed hub read still
 * produces a full row list — `buildCorePluginRows([])` marks every core
 * plugin `absent` with its CLI command — so the step stays useful even when
 * the dashboard is unreachable.
 */
import { useCallback, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { buildCorePluginRows } from '../lib/core-plugins'
import type { CorePluginRow } from '../lib/core-plugins'
import {
  disableAgentPlugin,
  enableAgentPlugin,
  getPluginsHub,
} from '@/lib/hermes-client'
import { useProviderMutations } from '@/screens/providers/hooks/use-provider-mutations'

const HUB_QUERY_KEY = ['onboarding', 'core-plugins-hub'] as const
const STATUS_QUERY_KEY = ['onboarding', 'core-plugins-gateway-status'] as const

type GatewayStatusPayload = { dashboard?: { available?: boolean } }

async function fetchGatewayStatus(): Promise<GatewayStatusPayload | null> {
  try {
    const res = await fetch('/api/gateway-status')
    if (!res.ok) return null
    return (await res.json()) as GatewayStatusPayload
  } catch {
    return null
  }
}

export type UseCorePluginsResult = {
  rows: Array<CorePluginRow>
  loading: boolean
  error: string | null
  toggle: (name: string, next: 'enable' | 'disable') => Promise<void>
  busyName: string | null
  touched: boolean
  refetch: () => void
  restart: () => Promise<void>
  restarting: boolean
  canRestart: boolean
}

export function useCorePlugins(input: {
  enabled: boolean
}): UseCorePluginsResult {
  const { enabled } = input
  const queryClient = useQueryClient()
  const [touched, setTouched] = useState(false)
  const [busyName, setBusyName] = useState<string | null>(null)
  const { restartGateway } = useProviderMutations()

  const hubQuery = useQuery({
    queryKey: HUB_QUERY_KEY,
    queryFn: getPluginsHub,
    enabled,
  })

  const statusQuery = useQuery({
    queryKey: STATUS_QUERY_KEY,
    queryFn: fetchGatewayStatus,
    enabled,
  })

  const rows = buildCorePluginRows(hubQuery.data?.plugins ?? [])
  const error = hubQuery.isError
    ? hubQuery.error instanceof Error
      ? hubQuery.error.message
      : "Couldn't reach the Plugins Hub."
    : null

  const refetch = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: HUB_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY })
  }, [queryClient])

  const toggle = useCallback(
    async (name: string, next: 'enable' | 'disable') => {
      setBusyName(name)
      try {
        if (next === 'enable') {
          await enableAgentPlugin(name)
        } else {
          await disableAgentPlugin(name)
        }
        setTouched(true)
      } catch {
        // Best-effort — the refetch below re-reads real hub state either
        // way, and the row itself keeps showing the last known status.
      } finally {
        setBusyName(null)
        refetch()
      }
    },
    [refetch],
  )

  const restart = useCallback(async () => {
    try {
      await restartGateway.mutateAsync()
    } catch {
      // Best-effort — surfaced by whatever the mutation's own error state
      // shows; the refetch below still re-reads the dashboard reachability.
    } finally {
      refetch()
    }
  }, [restartGateway, refetch])

  return {
    rows,
    loading: hubQuery.isLoading,
    error,
    toggle,
    busyName,
    touched,
    refetch,
    restart,
    restarting: restartGateway.isPending,
    canRestart: statusQuery.data?.dashboard?.available === true,
  }
}
