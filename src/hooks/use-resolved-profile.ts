/**
 * use-resolved-profile.ts — the React reader for the one profile resolver.
 *
 * There is exactly one answer to "which profile is this tab working in", it is
 * computed in `lib/session-scope.ts` (`url ?? device ?? null`), and this is how
 * a component subscribes to it. Nothing else may derive that answer: a
 * component that reads `useSessionsFilterStore(s => s.profile)` sees only the
 * device layer and will disagree with the composer the moment a `?profile=`
 * link outranks it — which is precisely the bug the resolver replaced.
 *
 * Why `useSyncExternalStore` over the router's `useSearch()`:
 *
 *   • It reads the *resolved* value, so a caller cannot accidentally consume
 *     one layer and miss the other.
 *   • It has no router context dependency, so the sidebar renders in isolation
 *     (tests, storybook) instead of throwing.
 *   • `getServerSnapshot` is the SSR contract: React uses it for the server
 *     render AND the hydrating client render, so both agree on the stable,
 *     unscoped value and the persisted selection only appears in the re-render
 *     that follows hydration. A concrete profile name guessed before the store
 *     has rehydrated would be a wrong-looking name in the markup and a
 *     hydration mismatch besides.
 */

import { useCallback, useSyncExternalStore } from 'react'
import type { ProfileScope } from '@/lib/session-scope'
import {
  getServerSessionProfileScope,
  getSessionProfileScope,
  resolveSessionProfileScopeForUrl,
  subscribeSessionProfileScope,
} from '@/lib/session-scope'

/** The resolved profile plus which layer supplied it. */
export function useProfileScope(): ProfileScope {
  return useSyncExternalStore(
    subscribeSessionProfileScope,
    getSessionProfileScope,
    getServerSessionProfileScope,
  )
}

/**
 * Same answer, but resolved against a `?profile=` the caller already holds
 * from the router rather than this module's own slot.
 *
 * Only for a component that reads `useSearch()` itself and could therefore be
 * a render ahead of `/chat/$sessionKey`'s `beforeLoad`. It still routes
 * through `resolveProfile`, so precedence stays defined in exactly one place
 * — the alternative, restating `url ?? device` at the call site, is a second
 * copy of the rule that only one test covers.
 */
export function useProfileScopeForUrl(urlProfile: unknown): ProfileScope {
  const getSnapshot = useCallback(
    () => resolveSessionProfileScopeForUrl(urlProfile),
    [urlProfile],
  )
  return useSyncExternalStore(
    subscribeSessionProfileScope,
    getSnapshot,
    getServerSessionProfileScope,
  )
}

/**
 * The resolved profile. `null` means unscoped — NOT the profile named
 * `default`, which is a real, servable profile under a multiplex gateway.
 */
export function useResolvedProfile(): string | null {
  return useProfileScope().profile
}

/**
 * True when the resolved profile comes from `?profile=` on this tab's URL.
 *
 * A device-level picker cannot outrank that, so a control that writes the
 * device layer must disable itself rather than offer a write the resolver
 * would discard.
 */
export function useProfilePinnedToUrl(): boolean {
  return useProfileScope().source === 'url'
}
