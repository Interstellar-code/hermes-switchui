/**
 * use-profile-scope-status.ts — read-only view of the live gateway's
 * multiplex topology, scoped to a single profile, for the Profiles screen
 * (G-05: "the screen cannot see the live gateway's topology").
 *
 * The chat composer already probes this via `fetchScopeStatus()` in
 * `chat-composer-services.ts`, under the query key `['profiles',
 * 'scope-status']` (see `session-selectors-v2.tsx`). This hook wraps the
 * exact same fetcher and key rather than opening a second poll — React Query
 * dedupes by queryKey, so every `useProfileScopeStatus` call (one per card or
 * row, up to ~96 per page) is a separate *observer* on one shared query, not
 * a separate HTTP request. Verified in the co-located test, which mounts N
 * consumers under one `QueryClient` and asserts `fetch` was called once.
 *
 * Semantics mirror `session-selectors-v2.tsx` exactly — do not reinvent them:
 *
 *  - `mode: 'multiplex'` — `servedProfiles` is authoritative. A profile not
 *    in that list is a real, actionable gap: the screen would let you
 *    activate it, but the live gateway will not answer for it.
 *  - `mode: 'single'` — the gateway serves exactly one profile, and a
 *    `/p/<name>/` prefix would be silently ignored, so in principle "served"
 *    means "is the gateway's own profile" (see `profile-scope.ts`'s
 *    `GatewayMode`). But `ScopeStatusResponse` deliberately does not expose
 *    *which* profile that is — the composer itself never renders a
 *    served/not-served badge in this mode either (`served` is `null` at
 *    session-selectors-v2.tsx around the "Agent profile" popover). The
 *    adjacent "you activated a profile the running gateway hasn't restarted
 *    onto yet" case is already owned by `gateway-restart-banner.tsx`, not by
 *    this probe. So single mode resolves to `'served'` (no badge) here too —
 *    matching "most users run single-gateway, where every visible profile is
 *    reachable" and keeping this a quiet, scan-only surface.
 *  - Anything else — the fetch failing, or no data yet — fails closed to
 *    `'unknown'`. It must never read as `'served'`: showing nothing is safer
 *    than a wrong "yes it works".
 */

import { useQuery } from '@tanstack/react-query'
import { fetchScopeStatus } from '@/screens/chat/components/chat-composer-services'

export type ProfileReachability = 'served' | 'not-served' | 'unknown'

/** Shared with `session-selectors-v2.tsx` on purpose — see module doc. */
export const PROFILE_SCOPE_STATUS_KEY = ['profiles', 'scope-status'] as const

export type ProfileScopeStatus = {
  reachability: ProfileReachability
  mode: 'single' | 'multiplex' | null
}

export function useProfileScopeStatus(
  profileName: string | undefined | null,
): ProfileScopeStatus {
  const query = useQuery({
    queryKey: PROFILE_SCOPE_STATUS_KEY,
    queryFn: fetchScopeStatus,
    staleTime: 5_000,
    retry: false,
  })

  const mode = query.data?.mode ?? null

  if (!profileName) return { reachability: 'served', mode }
  // Fail closed: no confirmed answer yet (still loading) or the probe itself
  // errored — never assert 'served' on missing information.
  if (query.isError || !query.data) return { reachability: 'unknown', mode }

  if (query.data.mode === 'multiplex') {
    const served = query.data.servedProfiles?.includes(profileName) ?? false
    return { reachability: served ? 'served' : 'not-served', mode }
  }

  // Single (non-multiplex): see module doc — deliberately quiet.
  return { reachability: 'served', mode }
}
