/**
 * use-profiles-list.ts — the single reader of `/api/profiles/list`.
 *
 * Six surfaces need this list (Profiles screen, agent wizard, tasks screen,
 * task drawer, cron wizard, self-improve scope select). They used to each
 * register their own `queryFn` under the shared `['profiles', 'list']` key
 * with *different* response shapes: the Profiles screen's version stripped
 * `activeProfile` and filtered out `default`, the rest returned the raw body.
 * Whichever observer happened to trigger the fetch won the cache entry, so the
 * wizard intermittently read `activeProfile === undefined` and silently skipped
 * create-mode seeding (no inherited model, no inherited provider, no name).
 *
 * The fix is this hook: one key, one fetcher, one shape — the raw body. Callers
 * that want a narrowed view pass `select`, which is per-observer and therefore
 * cannot corrupt what anyone else reads.
 */

import { useQuery } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import type { ProfileSummary } from '@/server/profiles-browser'

export const PROFILES_LIST_KEY = ['profiles', 'list'] as const

export type ProfilesListResponse = {
  profiles: Array<ProfileSummary>
  activeProfile?: string
}

export async function fetchProfilesList(): Promise<ProfilesListResponse> {
  const response = await fetch('/api/profiles/list')
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `Request failed (${response.status})`)
  }
  const body = (await response.json()) as Partial<ProfilesListResponse>
  return {
    profiles: Array.isArray(body.profiles) ? body.profiles : [],
    activeProfile: body.activeProfile,
  }
}

export function useProfilesList<TSelected = ProfilesListResponse>(
  opts: {
    select?: (data: ProfilesListResponse) => TSelected
    staleTime?: number
  } = {},
): UseQueryResult<TSelected, Error> {
  return useQuery<ProfilesListResponse, Error, TSelected>({
    queryKey: PROFILES_LIST_KEY,
    queryFn: fetchProfilesList,
    staleTime: opts.staleTime ?? 30_000,
    select: opts.select,
  })
}

/**
 * The Profiles screen's view: drop the synthetic `default` row (it duplicates
 * whichever named profile the gateway is actually running) and collapse
 * case-insensitive duplicates. Module-level so the `select` identity is stable.
 */
export function selectBrowsableProfiles(
  data: ProfilesListResponse,
): Array<ProfileSummary> {
  const seen = new Set<string>()
  return data.profiles.filter((p) => {
    const key = (p.name || '').toLowerCase()
    if (key === 'default') return false
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
