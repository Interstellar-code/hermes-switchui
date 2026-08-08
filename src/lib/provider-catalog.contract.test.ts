import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  CANONICAL_PROVIDER_IDS,
  PROVIDER_CATALOG,
  RESERVED_PROVIDER_ID,
  getProviderBaseUrl,
  getProviderEnvKey,
  getProviderEnvKeys,
  stripProviderPrefix,
} from './provider-catalog'

/**
 * The catalog is the single source of truth for which providers exist and
 * which env var holds each credential. These invariants are what let the
 * server route, the wizard, and the inventory screen agree.
 */
describe('provider catalog invariants', () => {
  it('gives every api-key provider a credential env var', () => {
    const missing = PROVIDER_CATALOG.filter(
      (provider) => provider.authTypes.includes('api-key') && !provider.envKey,
    ).map((provider) => provider.id)
    expect(missing).toEqual([])
  })

  it('never reuses an env var across providers', () => {
    const keys = PROVIDER_CATALOG.flatMap((provider) =>
      provider.envKey ? [provider.envKey] : [],
    )
    expect(keys).toEqual([...new Set(keys)])
  })

  it('has no duplicate ids', () => {
    expect(CANONICAL_PROVIDER_IDS).toEqual([...new Set(CANONICAL_PROVIDER_IDS)])
  })

  it('excludes the id the gateway refuses to resolve', () => {
    // `_get_named_custom_provider` returns None for this name — offering it
    // would let a user create a provider the gateway silently ignores.
    expect(CANONICAL_PROVIDER_IDS).not.toContain(RESERVED_PROVIDER_ID)
    expect(CANONICAL_PROVIDER_IDS).toContain('manifest')
  })

  it('marks local runtimes as local so the UI can probe them', () => {
    for (const id of ['ollama', 'atomic-chat']) {
      expect(PROVIDER_CATALOG.find((p) => p.id === id)?.origin).toBe('local')
    }
  })

  it('resolves env keys and base URLs through the helpers', () => {
    expect(getProviderEnvKey('openrouter')).toBe('OPENROUTER_API_KEY')
    expect(getProviderEnvKey('nous')).toBeNull()
    expect(getProviderEnvKeys('google')).toEqual([
      'GEMINI_API_KEY',
      'GOOGLE_API_KEY',
    ])
    expect(getProviderBaseUrl('ollama')).toBe('http://127.0.0.1:11434/v1')
    expect(getProviderBaseUrl('minimax')).toBeNull()
  })
})

describe('stripProviderPrefix', () => {
  it('removes a leading known-provider segment only', () => {
    expect(stripProviderPrefix('openrouter/nvidia/nemotron')).toBe(
      'nvidia/nemotron',
    )
    expect(stripProviderPrefix('anthropic/claude-sonnet-4-6')).toBe(
      'claude-sonnet-4-6',
    )
    expect(stripProviderPrefix('nvidia/nemotron')).toBe('nvidia/nemotron')
    expect(stripProviderPrefix('glm-4.6')).toBe('glm-4.6')
    expect(stripProviderPrefix('')).toBe('')
  })
})

/**
 * There used to be six divergent provider registries; only six ids were common
 * to the first three. These assertions keep the remaining display-only lists
 * anchored to the catalog so credentials can never be written under one name
 * and looked up under another.
 */
describe('registries stay anchored to the catalog', () => {
  const KNOWN_IDS = new Set([
    ...CANONICAL_PROVIDER_IDS,
    // Legacy id kept for installs predating `manifest`; see the server route.
    RESERVED_PROVIDER_ID,
  ])

  function idsIn(relPath: string, arrayName: string): Array<string> {
    const source = readFileSync(resolve(process.cwd(), relPath), 'utf8')
    const start = source.indexOf(`const ${arrayName}`)
    expect(start).toBeGreaterThan(-1)
    const end = source.indexOf('\n]', start)
    const block = source.slice(start, end)
    return [...block.matchAll(/\bid: '([a-z0-9-]+)'/g)].map((match) => match[1])
  }

  it('every provider offered by the quick settings dialog exists', () => {
    const ids = idsIn(
      'src/components/settings-dialog/settings-dialog.tsx',
      'PROVIDER_CARDS',
    )
    expect(ids.length).toBeGreaterThan(5)
    expect(ids.filter((id) => !KNOWN_IDS.has(id))).toEqual([])
  })

  it('every provider offered by onboarding exists', () => {
    const ids = idsIn(
      'src/components/onboarding/claude-onboarding.tsx',
      'PROVIDERS',
    )
    expect(ids.length).toBeGreaterThan(5)
    expect(ids.filter((id) => !KNOWN_IDS.has(id))).toEqual([])
  })

  it('no surface hardcodes a credential env var any more', () => {
    for (const relPath of [
      'src/components/settings-dialog/settings-dialog.tsx',
      'src/components/onboarding/claude-onboarding.tsx',
    ]) {
      const source = readFileSync(resolve(process.cwd(), relPath), 'utf8')
      // A bare `envKey: 'SOMETHING_API_KEY'` means the list drifted off-catalog.
      expect(source).not.toMatch(/envKey: '[A-Z_]+'/)
      expect(source).toMatch(/getProviderEnvKey\(/)
    }
  })

  it('keeps exactly one implementation of stripProviderPrefix', () => {
    const copies = [
      'src/components/onboarding/claude-onboarding.tsx',
      'src/components/settings-dialog/settings-dialog.tsx',
    ].filter((relPath) =>
      /function stripProviderPrefix/.test(
        readFileSync(resolve(process.cwd(), relPath), 'utf8'),
      ),
    )
    expect(copies).toEqual([])
  })
})

describe('server config route', () => {
  it('derives its provider list from the catalog instead of hardcoding one', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/routes/api/claude-config.ts'),
      'utf8',
    )
    expect(source).toMatch(/PROVIDER_CATALOG\.map/)

    // One legacy literal is expected — installs predating `manifest` still
    // carry a `custom` provider whose key must keep resolving.
    const literalEnvKeyLists = source.match(/envKeys: \['/g) ?? []
    expect(literalEnvKeyLists).toHaveLength(1)
    expect(source).toMatch(/id: 'custom'/)
  })
})
