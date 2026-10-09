import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { DashboardSocial } from '@/types/dashboard-social'
import { useResolvedProfile } from '@/hooks/use-resolved-profile'

const POLL_MS = 30_000
const PARTIAL_RETRY_MS = 5_000
const MAX_PARTIAL_RETRIES = 3

/**
 * Shared partial-response retry cadence (social + overview queries). Record
 * each response with `trackPartial`, then return `partialRetryInterval` from
 * `refetchInterval`: fast retry, at most MAX_PARTIAL_RETRIES times in a row,
 * then the normal poll. The streak counts the first partial response too,
 * hence `<=`.
 */
export function trackPartial(streak: { current: number }, partial: boolean) {
  streak.current = partial ? streak.current + 1 : 0
}

export function partialRetryInterval(
  partial: boolean,
  streak: { current: number },
): number {
  return partial && streak.current <= MAX_PARTIAL_RETRIES
    ? PARTIAL_RETRY_MS
    : POLL_MS
}

/** A slice is `null` when its upstream failed; `profile` is legitimately null. */
function hasNullSlice(data: DashboardSocial | undefined): boolean {
  if (!data) return false
  const { profile: _profile, ...slices } = data
  return Object.values(slices).some((value) => value === null)
}

/**
 * Social dashboard payload (`GET /api/dashboard/social`). `null` profile =
 * all profiles, so the param is omitted rather than sent empty.
 */
export function useDashboardSocial() {
  const profile = useResolvedProfile()
  // Consecutive responses with a null slice; reset by the first complete one.
  const partialStreak = useRef(0)
  return useQuery<DashboardSocial>({
    queryKey: ['dashboard', 'social', profile],
    queryFn: async () => {
      const qs = profile ? `?profile=${encodeURIComponent(profile)}` : ''
      const res = await fetch(`/api/dashboard/social${qs}`)
      if (!res.ok) throw new Error(`social ${res.status}`)
      const data = (await res.json()) as DashboardSocial
      trackPartial(partialStreak, hasNullSlice(data))
      return data
    },
    staleTime: 5_000,
    refetchInterval: (query) =>
      partialRetryInterval(hasNullSlice(query.state.data), partialStreak),
  })
}
