/**
 * flatten-config.ts — Flatten nested config objects to dotted keys with prefix.
 *
 * Example:
 *   flattenConfig({ memory: { provider: 'hindsight' } }, 'config.')
 *   → { 'config.memory.provider': 'hindsight' }
 */

export function flattenConfig(
  cfg: Record<string, unknown> | undefined,
  prefix = 'config.',
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(cfg ?? {})) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flattenConfig(v as Record<string, unknown>, `${prefix}${k}.`))
    } else {
      out[`${prefix}${k}`] = v
    }
  }
  return out
}
