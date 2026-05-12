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
 */

import { patchConfig } from '@/server/hermes-api'
import { toast } from '@/components/ui/toast'

const CONFIG_PREFIXES = ['workspace.', 'config.', 'agent.']

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
}
