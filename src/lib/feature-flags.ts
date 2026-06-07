// Lightweight client-side feature flags backed by localStorage.
//
// These are dev/opt-in toggles for in-progress UI work. They intentionally
// default OFF so the live experience is unchanged for everyone who hasn't
// explicitly flipped the flag.
//
// To enable the shadcn composer in the browser console:
//   localStorage.setItem('switchui:shadcn-composer', 'true')
// then reload. To disable:
//   localStorage.removeItem('switchui:shadcn-composer')

import { useCallback, useEffect, useState } from 'react'

/** localStorage key for the drop-in shadcn composer (Phase 2 #12). */
export const SHADCN_COMPOSER_FLAG_KEY = 'switchui:shadcn-composer'

/** Custom event fired when a feature flag is flipped via the setters below,
 *  so multiple mounted hooks stay in sync within the same tab. */
const FLAG_CHANGE_EVENT = 'switchui:feature-flag-change'

function readBooleanFlag(key: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(key) === 'true'
  } catch {
    return false
  }
}

function writeBooleanFlag(key: string, value: boolean): void {
  if (typeof window === 'undefined') return
  try {
    if (value) {
      window.localStorage.setItem(key, 'true')
    } else {
      window.localStorage.removeItem(key)
    }
    window.dispatchEvent(new CustomEvent(FLAG_CHANGE_EVENT, { detail: key }))
  } catch {
    // ignore quota / privacy-mode errors
  }
}

/**
 * Subscribe to a boolean localStorage flag. Default is `false`.
 * Returns `[enabled, setEnabled]`. The setter persists to localStorage and
 * notifies other hook instances in this tab + cross-tab `storage` events.
 */
function useBooleanFlag(key: string): [boolean, (next: boolean) => void] {
  const [enabled, setEnabled] = useState<boolean>(() => readBooleanFlag(key))

  useEffect(() => {
    function sync() {
      setEnabled(readBooleanFlag(key))
    }
    // cross-tab updates
    window.addEventListener('storage', sync)
    // same-tab updates (storage event does not fire in the originating tab)
    window.addEventListener(FLAG_CHANGE_EVENT, sync)
    // re-read on mount in case it changed before the listeners attached
    sync()
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener(FLAG_CHANGE_EVENT, sync)
    }
  }, [key])

  const set = useCallback(
    (next: boolean) => {
      writeBooleanFlag(key, next)
      setEnabled(next)
    },
    [key],
  )

  return [enabled, set]
}

/**
 * Whether the drop-in shadcn composer is enabled. Defaults to `false`, so the
 * live `<ChatComposer>` remains the default with zero regression. The returned
 * setter lets a dev toggle (e.g. the /composer-preview route) flip it.
 */
export function useShadcnComposer(): [boolean, (next: boolean) => void] {
  return useBooleanFlag(SHADCN_COMPOSER_FLAG_KEY)
}
