/**
 * Tristate hook: null = loading, true = plugin available, false = not available.
 * Checks /api/dashboard/plugins for an entry with name === 'karpathy-self-improve'.
 */
import { useQuery } from '@tanstack/react-query'
import { listDashboardPlugins } from '@/lib/hermes-client'

interface DashboardPlugin {
  name: string
  [key: string]: unknown
}

export function useSelfImproveAvailable(): boolean | null {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-plugins'],
    queryFn: async () => {
      const raw = await listDashboardPlugins()
      // Response may be wrapped ({plugins:[...]}) or a bare array
      if (Array.isArray(raw)) return raw as Array<DashboardPlugin>
      if (raw && typeof raw === 'object') {
        const obj = raw as Record<string, unknown>
        const arr = obj['plugins'] ?? obj['data'] ?? obj['items']
        if (Array.isArray(arr)) return arr as Array<DashboardPlugin>
      }
      return [] as Array<DashboardPlugin>
    },
    staleTime: 30_000,
  })

  if (isLoading || data === undefined) return null
  return data.some((p) => p.name === 'karpathy-self-improve')
}
