/**
 * plugin-settings-mirror.ts — mirrors browser-local UI preferences to the
 * Hermes dashboard plugin.
 *
 * The plugin displays the workspace's current preferences (the "reported
 * settings" list in Settings → Hermes Plugin). It learns them from
 * `POST /api/hermes-plugin/settings`, whose server side strips everything
 * outside `SETTINGS_ALLOWLIST` (see `@/server/hermes-plugin-sync`).
 *
 * This used to live in the Settings screen's saver, which was the wrong owner
 * twice over. It fired only on an explicit gateway-config save, so a
 * preference changed anywhere else was never reported; and five of the six
 * keys it mapped were `hermes.*` localStorage keys that no code read, since
 * deleted. The one genuinely live key it carried — theme — is owned by the
 * studio settings store, so that is where the mirror belongs.
 *
 * It is deliberately fire-and-forget: a workspace whose plugin is unreachable
 * must keep working, and a failed mirror is a cosmetic staleness in one
 * read-only panel, never a reason to surface an error.
 */

import type { StudioSettings } from '@/hooks/use-settings'
import { resolveTheme, useStudioSettingsStore } from '@/hooks/use-settings'

/** Trailing debounce, so dragging a slider sends one request rather than many. */
const DEBOUNCE_MS = 2_000

let timer: ReturnType<typeof setTimeout> | null = null
let warnedOnce = false
let stopCurrent: (() => void) | null = null

/**
 * Map studio settings onto the plugin's allowlisted names. Only keys the
 * server allowlist actually accepts are worth sending — anything else is
 * stripped there anyway.
 *
 * `theme` is resolved to a concrete `light`/`dark` because the plugin renders
 * it as a value, and `system` would tell it nothing about what the user sees.
 */
export function buildPluginSettingsPayload(
  settings: StudioSettings,
): Record<string, unknown> {
  return {
    theme: resolveTheme(settings.theme),
    enableDesktopNotifications: settings.notificationsEnabled,
    enableSoundNotifications: settings.notificationsEnabled,
    fontSize: settings.editorFontSize,
  }
}

function send(payload: Record<string, unknown>): void {
  void fetch('/api/hermes-plugin/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {
    if (!warnedOnce) {
      warnedOnce = true
      console.warn(
        '[plugin-settings-mirror] mirror failed; suppressing further warnings',
      )
    }
  })
}

function schedule(settings: StudioSettings): void {
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    send(buildPluginSettingsPayload(settings))
  }, DEBOUNCE_MS)
}

/**
 * Subscribe the mirror to studio-settings changes. Browser-only, so it is a
 * no-op during SSR.
 *
 * Calling it again *replaces* the previous subscription rather than no-opping.
 * A guard that silently ignored the second call would leave a stale
 * subscription alive under React StrictMode's double-invoked effects, and made
 * the module impossible to exercise across more than one test.
 *
 * Does NOT send an initial snapshot — the plugin reads its own state on
 * connect, and firing on every page load would be noise.
 */
export function startPluginSettingsMirror(): () => void {
  if (typeof window === 'undefined') return () => {}

  stopCurrent?.()

  const unsubscribe = useStudioSettingsStore.subscribe((state, prev) => {
    if (state.settings === prev.settings) return
    schedule(state.settings)
  })

  const stop = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    unsubscribe()
    if (stopCurrent === stop) stopCurrent = null
  }

  stopCurrent = stop
  return stop
}
