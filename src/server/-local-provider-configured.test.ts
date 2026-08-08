/**
 * `custom_providers` entries were read two different ways: models.ts indexes
 * them by `id`, this module matched only on `name`. A provider written by one
 * was invisible to the other.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import YAML from 'yaml'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let home: string

async function loadModule() {
  process.env.HERMES_HOME = home
  vi.resetModules()
  return import('./local-provider-discovery')
}

function seed(customProviders: Array<Record<string, unknown>>) {
  writeFileSync(
    join(home, 'config.yaml'),
    YAML.stringify({ custom_providers: customProviders }),
    'utf-8',
  )
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'hermes-local-providers-'))
})

describe('isProviderConfigured', () => {
  it('matches an entry keyed by id, the shape models.ts reads', async () => {
    seed([{ id: 'ollama', base_url: 'http://127.0.0.1:11434/v1' }])
    const { isProviderConfigured } = await loadModule()
    expect(isProviderConfigured('ollama')).toBe(true)
  })

  it('still matches an entry keyed by name, as older configs have', async () => {
    seed([{ name: 'ollama', base_url: 'http://127.0.0.1:11434/v1' }])
    const { isProviderConfigured } = await loadModule()
    expect(isProviderConfigured('ollama')).toBe(true)
  })

  it('does not match an unrelated provider', async () => {
    seed([{ id: 'atomic-chat' }])
    const { isProviderConfigured } = await loadModule()
    expect(isProviderConfigured('ollama')).toBe(false)
  })

  it('returns false when there are no custom providers at all', async () => {
    writeFileSync(join(home, 'config.yaml'), YAML.stringify({}), 'utf-8')
    const { isProviderConfigured } = await loadModule()
    expect(isProviderConfigured('ollama')).toBe(false)
  })
})
