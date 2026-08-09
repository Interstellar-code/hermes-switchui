import { describe, expect, it } from 'vitest'
import {
  MEMORY_PROVIDER_CATALOG,
  MEMORY_PROVIDER_IDS,
  MEMORY_PROVIDER_SELECT_OPTIONS_WITH_DISABLED,
  getMemoryProviderInfo,
} from './memory-provider-catalog'

/**
 * The list is the full on-disk set under
 * `~/.hermes/hermes-agent/plugins/memory/`. It was six of nine, which meant
 * Settings → Memory could not select `matrix-memory`, `honcho` or
 * `supermemory` — including on machines already running one of them.
 */
const ON_DISK_PLUGINS = [
  'matrix-memory',
  'holographic',
  'hindsight',
  'mem0',
  'openviking',
  'retaindb',
  'supermemory',
  'honcho',
  'byterover',
]

describe('memory-provider-catalog', () => {
  it('keeps the runtime memory provider ids in one shared list', () => {
    expect(MEMORY_PROVIDER_IDS).toEqual(ON_DISK_PLUGINS)
  })

  it('offers the shared settings select list with only disabled plus runtime providers', () => {
    expect(
      MEMORY_PROVIDER_SELECT_OPTIONS_WITH_DISABLED.map(
        (option) => option.value,
      ),
    ).toEqual(['', ...ON_DISK_PLUGINS])
  })

  it('recommends exactly one provider, and it is the zero-setup local one', () => {
    const recommended = MEMORY_PROVIDER_CATALOG.filter(
      (entry) => entry.recommended,
    )
    expect(recommended.map((entry) => entry.id)).toEqual(['matrix-memory'])
    expect(recommended[0].setup).toBe('none')
    expect(recommended[0].local).toBe(true)
  })

  it('never marks a remote provider as needing no setup', () => {
    // `setup: 'none'` is the claim that selecting it is enough. A provider
    // that talks to someone else's service cannot honestly make it.
    for (const entry of MEMORY_PROVIDER_CATALOG) {
      if (entry.setup === 'none') expect(entry.local, entry.id).toBe(true)
    }
  })

  it('does not resolve stale provider ids', () => {
    expect(getMemoryProviderInfo('builtin')).toBeNull()
    expect(getMemoryProviderInfo('')).toBeNull()
    expect(getMemoryProviderInfo(null)).toBeNull()
    // But the three that were missing now resolve.
    expect(getMemoryProviderInfo('matrix-memory')?.label).toBe('Matrix Memory')
    expect(getMemoryProviderInfo('honcho')?.label).toBe('Honcho')
    expect(getMemoryProviderInfo('supermemory')?.label).toBe('Supermemory')
  })
})
