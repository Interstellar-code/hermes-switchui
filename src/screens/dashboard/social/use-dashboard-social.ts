import { useQuery } from '@tanstack/react-query'
import type { DashboardSocial } from '@/types/dashboard-social'
import { useResolvedProfile } from '@/hooks/use-resolved-profile'

/**
 * Social dashboard payload (`GET /api/dashboard/social`). `null` profile =
 * all profiles, so the param is omitted rather than sent empty.
 */
export function useDashboardSocial() {
  const profile = useResolvedProfile()
  return useQuery<DashboardSocial>({
    queryKey: ['dashboard', 'social', profile],
    queryFn: async () => {
      const qs = profile ? `?profile=${encodeURIComponent(profile)}` : ''
      const res = await fetch(`/api/dashboard/social${qs}`)
      if (!res.ok) throw new Error(`social ${res.status}`)
      return (await res.json()) as DashboardSocial
    },
    staleTime: 5_000,
    refetchInterval: 30_000,
  })
}
