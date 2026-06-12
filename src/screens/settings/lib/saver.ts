/**
 * saver.ts — Settings save handler.
 * Keys prefixed `hermes.`  → localStorage
 * Keys prefixed `workspace.`, `config.`, or `agent.` → patchConfig via hermes-api
 *
 * Dot-notation keys are expanded into nested objects before patching, so
 * `config.agent.worker_pool` becomes `{ config: { agent: { worker_pool: N } } }`.
 *
 * If patchConfig returns a 400 (unsupported key on this gateway version) a toast
 * is shown but the saver does not throw.
 *
 * After each successful save, allowlisted settings are mirrored fire-and-forget
 * to POST /api/hermes-plugin/settings so the Hermes dashboard plugin can observe
 * the current workspace configuration. Failures are silently swallowed and never
 * block the main settings save.
 */

import { patchConfig } from '@/lib/hermes-client'
import { toast } from '@/components/ui/toast'

const CONFIG_PREFIXES = ['workspace.', 'config.', 'agent.']

// ── Hermes plugin settings mirror ─────────────────────────────────────────────

/**
 * Maps store keys (hermes.* prefix form) to the bare names expected by
 * /api/hermes-plugin/settings (which the server-side SETTINGS_ALLOWLIST filters).
 *
 * Only keys that appear in the backend SETTINGS_ALLOWLIST are listed here.
 * Keys with no backend analogue are deliberately omitted — if a new backend
 * field is added, extend both SETTINGS_ALLOWLIST (server) and this map (client).
 *
 * Coverage:
 *   theme                 ← hermes.theme
 *   locale                ← hermes.lang
 *   compactMode           ← hermes.density (true when value === 'compact')
 *   enableSoundNotifications    ← hermes.notif.sound
 *   enableDesktopNotifications  ← hermes.notif.desktop
 *   fontSize              ← hermes.monoFont   (nearest proxy; no bare fontSize key)
 *
 * Not yet mapped (no corresponding hermes.* key in the UI):
 *   showTimestamps, showTokenCounts, showCostEstimates, codeHighlighting,
 *   customPort, frontendPort
 */
const STORE_KEY_TO_PLUGIN: Record<string, string> = {
  'hermes.theme': 'theme',
  'hermes.lang': 'locale',
  'hermes.density': 'compactMode',
  'hermes.notif.sound': 'enableSoundNotifications',
  'hermes.notif.desktop': 'enableDesktopNotifications',
  'hermes.monoFont': 'fontSize',
}

let _mirrorWarnedOnce = false

/**
 * Debounce handle for the mirror POST. Trailing 2s so rapid save clicks
 * collapse to a single network call.
 */
let _mirrorTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Build the plugin settings payload from the full committed settings snapshot.
 * Called with the snapshot after a save so we always send the full current
 * state, not just the dirty patch.
 */
function _buildPluginPayload(snapshot: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [storeKey, pluginKey] of Object.entries(STORE_KEY_TO_PLUGIN)) {
    const raw = snapshot[storeKey]
    if (raw === undefined) continue

    // Special coercion: density → boolean compactMode
    if (storeKey === 'hermes.density') {
      out[pluginKey] = raw === 'compact'
      continue
    }
    // Boolean string coercion for notif toggles
    if (storeKey === 'hermes.notif.sound' || storeKey === 'hermes.notif.desktop') {
      out[pluginKey] = raw === 'true' || raw === true
      continue
    }
    out[pluginKey] = raw
  }
  return out
}

/**
 * Fire-and-forget POST to /api/hermes-plugin/settings.
 * Debounced at 2s trailing. Swallows all errors; logs one console.warn on the
 * first failure per page session and stays silent thereafter.
 */
function _scheduleMirror(snapshot: Record<string, unknown>): void {
  if (_mirrorTimer !== null) clearTimeout(_mirrorTimer)
  _mirrorTimer = setTimeout(() => {
    _mirrorTimer = null
    const payload = _buildPluginPayload(snapshot)
    if (Object.keys(payload).length === 0) return

    void fetch('/api/hermes-plugin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {
      if (!_mirrorWarnedOnce) {
        _mirrorWarnedOnce = true
        console.warn('[hermes-plugin-mirror] settings mirror failed (subsequent failures suppressed)')
      }
    })
  }, 2_000)
}

function setNestedPath(
  obj: Record<string, unknown>,
  parts: Array<string>,
  value: unknown,
): void {
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') {
      cur[parts[i]] = {}
    }
    cur = cur[parts[i]] as Record<string, unknown>
  }
  cur[parts[parts.length - 1]] = value
}

export async function settingsSaver(patch: Record<string, unknown>): Promise<void> {
  const configPatch: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(patch)) {
    if (key.startsWith('hermes.')) {
      try {
        if (value === null || value === undefined) {
          localStorage.removeItem(key)
        } else {
          localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
        }
      } catch {
        // ignore storage errors
      }
    } else if (CONFIG_PREFIXES.some((p) => key.startsWith(p))) {
      // Build nested config patch from dot-notation key
      setNestedPath(configPatch, key.split('.'), value)
    }
  }

  if (Object.keys(configPatch).length > 0) {
    try {
      await patchConfig(configPatch)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('400')) {
        toast('Some settings are unsupported on this gateway version', { type: 'warning' })
      }
      // Gateway may not be available; continue without crashing
    }
  }

  // Mirror allowlisted settings to the Hermes plugin — fire and forget.
  // Build the full current snapshot for mapped keys from localStorage so we
  // send the authoritative post-save state, not just the dirty patch.
  const lsSnapshot: Record<string, unknown> = {}
  for (const storeKey of Object.keys(STORE_KEY_TO_PLUGIN)) {
    // Prefer value from the incoming patch (just written); fall back to storage.
    if (storeKey in patch) {
      lsSnapshot[storeKey] = patch[storeKey]
    } else {
      try {
        const stored = localStorage.getItem(storeKey)
        if (stored !== null) lsSnapshot[storeKey] = stored
      } catch {
        // ignore storage errors
      }
    }
  }
  _scheduleMirror(lsSnapshot)
}
