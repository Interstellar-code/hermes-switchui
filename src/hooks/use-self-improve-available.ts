/**
 * Tristate hook: null = loading, true = active, false = inactive.
 * The SwitchUI plugin reports the gateway's live enabled-plugin list.
 */
import { useQuery } from '@tanstack/react-query'

const SELF_IMPROVE_PLUGIN = 'karpathy-self-improve'

type HermesPluginSnapshot = {
  connection?: { enabled_plugins?: Array<string> | null } | null
}

export function isSelfImprovePluginActive(
  enabledPlugins: ReadonlyArray<string> | null | undefined,
): boolean {
  return enabledPlugins?.includes(SELF_IMPROVE_PLUGIN) === true
}

async function fetchEnabledPlugins(): Promise<Array<string>> {
  const response = await fetch('/api/hermes-plugin', { cache: 'no-store' })
  if (!response.ok) throw new Error(`status ${response.status}`)
  const snapshot = (await response.json()) as HermesPluginSnapshot
  return Array.isArray(snapshot.connection?.enabled_plugins)
    ? snapshot.connection.enabled_plugins
    : []
}

export function useSelfImproveAvailable(): boolean | null {
  const { data, isError, isLoading } = useQuery({
    queryKey: ['hermes-plugin', 'enabled-plugins'],
    queryFn: fetchEnabledPlugins,
    staleTime: 5_000,
    refetchInterval: 5_000,
    retry: 1,
  })

  if (isError) return false
  if (isLoading || data === undefined) return null
  return isSelfImprovePluginActive(data)
}
