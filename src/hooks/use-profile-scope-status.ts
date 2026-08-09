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
 * Semantics mirror `session-selectors-v2.tsx` where they overlap — do not
 * reinvent them:
 *
 *  - `mode: 'multiplex'` — `servedProfiles` is authoritative. A profile not
 *    in that list is a real, actionable gap: the screen would let you
 *    activate it, but the live gateway will not answer for it.
 *  - `mode: 'single'` — the gateway serves exactly one profile, and a
 *    `/p/<name>/` prefix would be rejected (or, on an unpatched gateway,
 *    silently ignored — see `profile-scope.ts`). `servingProfile`
 *    (`gateway-status.ts`, forwarding `profile-scope.ts`'s `GatewayMode`
 *    `activeProfile`) now names exactly which one that is, so this branch
 *    compares directly instead of asserting 'served' unconditionally the way
 *    it used to. That old behaviour existed ONLY because the serving profile
 *    was unavailable to this hook — not because single-mode reachability is
 *    unknowable. Fixing the payload fixes the hook.
 *  - `mode: 'unknown'` — topology couldn't be established at all (a
 *    remote/gated dashboard withheld the detail, or the probe itself failed —
 *    see `profile-scope.ts`'s `GatewayMode`). Never guess 'served' here;
 *    that's the exact silent-write hazard this probe exists to surface.
 *  - Anything else — the fetch failing, or no data yet — fails closed to
 *    `'unknown'`. It must never read as `'served'`: showing nothing is safer
 *    than a wrong "yes it works".
 */

import { useQuery } from '@tanstack/react-query'
import type { ScopeStatusResponse } from '@/screens/chat/components/chat-composer-types'
import { fetchScopeStatus } from '@/screens/chat/components/chat-composer-services'

export type ProfileReachability = 'served' | 'not-served' | 'unknown'

/** Shared with `session-selectors-v2.tsx` on purpose — see module doc. */
export const PROFILE_SCOPE_STATUS_KEY = ['profiles', 'scope-status'] as const

export type ProfileScopeStatus = {
  reachability: ProfileReachability
  mode: 'single' | 'multiplex' | 'unknown' | null
  /**
   * The single-mode gateway's own active (serving) profile, when known.
   * `null` in every other case — multiplex (meaningless there), unknown
   * topology, or no data yet. Exposed so a "not served" badge in single mode
   * can name what IS actually running instead of just saying "not this one".
   */
  servingProfile: string | null
}

/**
 * `/api/gateway-status`'s `scope` object is typed by `ScopeStatusResponse`
 * (chat-composer-types.ts, owned by the chat-composer surface) as
 * `mode: 'single' | 'multiplex'`, because the composer never needed to
 * branch on anything else. `profile-scope.ts`'s `GatewayMode` gained a third
 * state — `'unknown'`, for topology that couldn't be established — and the
 * route now also forwards `servingProfile` (the `single`-mode gateway's own
 * active profile). Both are real fields on the wire; this local type reads
 * them without touching the shared contract other surfaces depend on.
 */
type GatewayScopeStatus = Omit<ScopeStatusResponse, 'mode'> & {
  mode: 'single' | 'multiplex' | 'unknown'
  servingProfile?: string | null
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

  const data = query.data as GatewayScopeStatus | undefined
  const mode = data?.mode ?? null
  const servingProfile = mode === 'single' ? (data?.servingProfile ?? null) : null

  if (!profileName) return { reachability: 'served', mode, servingProfile: null }
  // Fail closed: no confirmed answer yet (still loading) or the probe itself
  // errored — never assert 'served' on missing information.
  if (query.isError || !data) {
    return { reachability: 'unknown', mode, servingProfile: null }
  }

  if (data.mode === 'multiplex') {
    const served = data.servedProfiles?.includes(profileName) ?? false
    return { reachability: served ? 'served' : 'not-served', mode, servingProfile: null }
  }

  if (data.mode === 'unknown') {
    return { reachability: 'unknown', mode, servingProfile: null }
  }

  // Single (non-multiplex): compare directly against the gateway's own
  // active profile — see module doc. A missing `servingProfile` (an old
  // payload shape, or a probe that reported `single` without pinning down
  // which profile) fails closed to 'unknown' rather than silently 'served'.
  if (!servingProfile) return { reachability: 'unknown', mode, servingProfile: null }
  return {
    reachability: servingProfile === profileName ? 'served' : 'not-served',
    mode,
    servingProfile,
  }
}
