'use client'

/**
 * use-profile-servability.ts — the live half of `profile-servability.ts`.
 *
 * Fetches through the exact same shared query the chat composer and
 * `useProfileScopeStatus` already probe: `PROFILE_SCOPE_STATUS_KEY` →
 * `/api/gateway-status`'s `scope`, itself a forward of `profile-scope.ts`'s
 * `getGatewayMode()`. TanStack Query dedupes by key, so mounting this hook
 * alongside either of those adds an *observer* to an existing request rather
 * than a second network round trip — see `use-profile-scope-status.ts`'s
 * header, which documents and tests the same guarantee.
 *
 * `diskProfiles` is supplied by the caller rather than fetched here: the
 * wizard already has it from `useOnboardingProfiles`, and threading it in
 * keeps this hook from opening a second, redundant `/api/profiles/list` read.
 */
import { useQuery } from '@tanstack/react-query'
import { evaluateProfileServability } from '../lib/profile-servability'
import type { ProfileServabilityResult } from '../lib/profile-servability'
import { fetchScopeStatus } from '@/screens/chat/components/chat-composer-services'
import { PROFILE_SCOPE_STATUS_KEY } from '@/hooks/use-profile-scope-status'

export function useProfileServability(input: {
  enabled: boolean
  diskProfiles: Array<string>
}): ProfileServabilityResult | null {
  const { enabled, diskProfiles } = input

  const query = useQuery({
    queryKey: PROFILE_SCOPE_STATUS_KEY,
    queryFn: fetchScopeStatus,
    enabled,
    staleTime: 5_000,
    retry: false,
  })

  if (!enabled) return null

  // Fails closed to "topology unreachable" rather than silently reading as
  // 'ok' — a probe that errored must never be mistaken for a healthy one, the
  // same rule `useProfileScopeStatus` follows for the composer's picker.
  if (query.isError) {
    return evaluateProfileServability(diskProfiles, {
      mode: 'unknown',
      servedProfiles: null,
      activeProfile: null,
      reason: 'probe-failed',
    })
  }

  // Still loading: nothing to say yet, rather than a guessed answer.
  if (!query.data) return null

  return evaluateProfileServability(diskProfiles, {
    mode: query.data.mode,
    servedProfiles: query.data.servedProfiles ?? null,
    activeProfile: query.data.servingProfile ?? null,
    reason: query.data.reason ?? null,
  })
}
