/**
 * saver.ts — Settings transport.
 *
 * This module is *only* transport: it turns a flat dirty patch into the body
 * `PUT /api/config` expects, sends it, and reports which keys actually landed.
 * It never toasts and never swallows an error — the screen owns all messaging,
 * and the store commits only what `persisted` says was written.
 *
 * Dot-notation keys are expanded into nested objects, so
 * `config.agent.worker_pool` becomes `{ config: { agent: { worker_pool: N } } }`.
 * The gateway deep-merges that server-side, so sending only the dirty subtree
 * is safe.
 *
 * History: this used to send `PATCH /api/config` (405 on every real gateway),
 * report success anyway, and additionally mirror six browser-local keys to the
 * dashboard plugin settings endpoint. Both are gone; see
 * `settings-transport.contract.test.ts` and `saver.test.ts`.
 */

import { putConfig } from '@/lib/hermes-client'

/** A key that could not be written, with a human-readable reason. */
export type SaveFailure = { key: string; reason: string }

/**
 * Result of one save attempt. `persisted` is the only thing the store may
 * commit; every other dirty key stays dirty.
 */
export type SaveOutcome = { persisted: Array<string>; failed: Array<SaveFailure> }

export type SettingsSaver = (
  patch: Record<string, unknown>,
) => Promise<SaveOutcome>

/** Keys under this prefix are the only ones with a persistence route today. */
const CONFIG_PREFIX = 'config.'

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

/**
 * Split a flat patch into the `PUT /api/config` body plus the keys that were
 * routed into it and the keys that have nowhere to go. Exported for unit test.
 */
export function buildConfigBody(patch: Record<string, unknown>): {
  body: Record<string, unknown>
  routed: Array<string>
  unroutable: Array<string>
} {
  const body: Record<string, unknown> = {}
  const routed: Array<string> = []
  const unroutable: Array<string> = []

  for (const [key, value] of Object.entries(patch)) {
    if (key.startsWith(CONFIG_PREFIX)) {
      setNestedPath(body, key.split('.'), value)
      routed.push(key)
    } else {
      unroutable.push(key)
    }
  }

  return { body, routed, unroutable }
}

export const settingsSaver: SettingsSaver = async (patch) => {
  const { body, routed, unroutable } = buildConfigBody(patch)

  const failed: Array<SaveFailure> = unroutable.map((key) => ({
    key,
    reason: 'No persistence route for this key',
  }))

  if (routed.length === 0) {
    return { persisted: [], failed }
  }

  try {
    await putConfig(body)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return {
      persisted: [],
      failed: [...failed, ...routed.map((key) => ({ key, reason }))],
    }
  }

  return { persisted: routed, failed }
}
