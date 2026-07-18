/**
 * Extracted helper for #136 — mtime-gated config cache.
 * Kept in a separate module so it can be unit-tested without importing the
 * full TanStack route (which pulls in gateway/auth server modules).
 */
import fs from 'node:fs'
import YAML from 'yaml'

interface ConfigCache {
  mtimeMs: number
  model: string
}

let _configCache: ConfigCache | null = null

/**
 * Read the active model from config.yaml at `configPath`.
 * Uses an mtime-gated cache: `statSync` is called every time (cheap), but
 * `readFileSync` + YAML.parse are only called when the file has changed.
 * Returns '' when the file is missing, unreadable, or has no model field.
 */
export function readActiveModel(configPath: string): string {
  try {
    const { mtimeMs } = fs.statSync(configPath)
    if (_configCache && _configCache.mtimeMs === mtimeMs) {
      return _configCache.model
    }
    const raw = fs.readFileSync(configPath, 'utf-8')
    const config = (YAML.parse(raw) as Record<string, unknown> | null) ?? {}
    const modelField = config.model
    let model = ''
    if (typeof modelField === 'string') {
      model = modelField
    } else if (modelField && typeof modelField === 'object') {
      const obj = modelField as Record<string, unknown>
      model = (obj.default as string) || ''
    }
    _configCache = { mtimeMs, model }
    return model
  } catch {
    // config missing, stat error, or unreadable
  }
  return ''
}

/** Reset the module-level cache (used in tests via vi.resetModules). */
export function _resetCacheForTest(): void {
  _configCache = null
}
