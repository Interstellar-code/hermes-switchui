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
 *    remote/gated dashboard withheld the detail, the probe itself failed, or
 *    several independent per-profile gateways are running and none could be
 *    matched to this workspace's gateway URL — see `profile-scope.ts`'s
 *    `GatewayMode`). Never guess 'served' here; that's the exact silent-write
 *    hazard this probe exists to surface.
 *  - `profileGateways` (the multi-gateway topology) — per-profile liveness
 *    straight from the dashboard. It is what makes "not served" specific:
 *    no gateway at all, a gateway with no API server, or one on a port this
 *    workspace isn't pointed at. The picker shows that at SELECTION time, so
 *    an unreachable profile is refused with a reason before a message is
 *    composed rather than after it is sent.
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
  /**
   * One short sentence saying WHY, whenever `reachability` isn't `'served'`
   * and we actually know. `null` for the healthy case and for "still loading"
   * — a picker showing a reason on every row in a normal single-gateway
   * install would be noise, so callers render this only when it is set.
   */
  reason: string | null
}

/** Reachability of one profile from a scope payload — pure, so the composer
 *  picker and this hook cannot drift apart (see module doc). `data` is
 *  `undefined` while loading or on a failed probe. */
export function profileReachability(
  data: ScopeStatusResponse | undefined,
  profileName: string | undefined | null,
): ProfileScopeStatus {
  const mode = data?.mode ?? null
  const roster = data?.profileGateways ?? null
  const servingProfile = mode === 'single' ? (data?.servingProfile ?? null) : null

  if (!profileName) {
    return { reachability: 'served', mode, servingProfile: null, reason: null }
  }
  // Fail closed: no confirmed answer yet (still loading) or the probe itself
  // errored — never assert 'served' on missing information.
  if (!data) {
    return { reachability: 'unknown', mode, servingProfile: null, reason: null }
  }

  if (data.mode === 'multiplex') {
    const served = data.servedProfiles?.includes(profileName) ?? false
    return {
      reachability: served ? 'served' : 'not-served',
      mode,
      servingProfile: null,
      reason: served
        ? null
        : `This gateway multiplexes, but does not serve "${profileName}".`,
    }
  }

  if (data.mode === 'unknown') {
    return {
      reachability: 'unknown',
      mode,
      servingProfile: null,
      reason:
        data.reason === 'multiple-gateways'
          ? `${describeGateway(profileName, roster)} This host runs one gateway per profile and none of them could be matched to this workspace's gateway URL.`
          : data.reason === 'remote-gated'
            ? 'This dashboard is remote/gated, so it withholds the topology needed to confirm any profile.'
            : data.reason === 'probe-failed'
              ? 'The gateway topology probe failed — the Hermes dashboard was unreachable or answered unexpectedly.'
              : null,
    }
  }

  // Single (non-multiplex): compare directly against the gateway's own
  // active profile — see module doc. A missing `servingProfile` (an old
  // payload shape, or a probe that reported `single` without pinning down
  // which profile) fails closed to 'unknown' rather than silently 'served'.
  if (!servingProfile) {
    return { reachability: 'unknown', mode, servingProfile: null, reason: null }
  }
  if (servingProfile === profileName) {
    return { reachability: 'served', mode, servingProfile, reason: null }
  }
  return {
    reachability: 'not-served',
    mode,
    servingProfile,
    // `roster` non-null ⇒ the multi-gateway topology: say what is (or isn't)
    // running for THIS profile rather than "the gateway runs something else".
    reason: roster
      ? `${describeGateway(profileName, roster)} This workspace is connected to the "${servingProfile}" gateway.`
      : `This gateway runs the "${servingProfile}" profile and is not multiplexed.`,
  }
}

/** Mirrors `profile-scope.ts`'s `describeProfileGateway`, as a full sentence. */
function describeGateway(
  profileName: string,
  roster: Array<{ profile: string; apiPort: number | null }> | null,
): string {
  const entry = roster?.find((g) => g.profile === profileName)
  if (!roster || !entry) return `No gateway is running for "${profileName}".`
  if (entry.apiPort === null) {
    return `A gateway is running for "${profileName}" but exposes no API server, so nothing can be sent to it.`
  }
  return `The gateway for "${profileName}" listens on port ${entry.apiPort}.`
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

  return profileReachability(
    query.isError ? undefined : query.data,
    profileName,
  )
}
