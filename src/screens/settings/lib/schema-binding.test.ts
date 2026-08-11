// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EMPTY_SCHEMA_INDEX,
  buildSchemaIndex,
  humanizeKey,
  normalizeType,
  optionsFor,
  orderCategories,
  useConfigSchema,
  useRegisterSchemaDefaults,
  useSchemaDefaults,
  widgetFor,
} from './schema-binding'
import type { ReactNode } from 'react'
import { resetSettingsStore, useSettingsStore } from '@/stores/settings-store'

const { mockGetConfigSchema, mockGetConfigDefaults } = vi.hoisted(() => ({
  mockGetConfigSchema: vi.fn(),
  mockGetConfigDefaults: vi.fn(),
}))

vi.mock('@/lib/hermes-client', () => ({
  getConfigSchema: mockGetConfigSchema,
  getConfigDefaults: mockGetConfigDefaults,
}))

/** A trimmed stand-in for the live payload, same shape, same quirks. */
const SCHEMA = {
  category_order: ['general', 'agent', 'terminal'],
  fields: {
    model: { type: 'string', description: 'Default model', category: 'general' },
    'agent.max_turns': {
      type: 'number',
      description: 'Agent → Max Turns',
      category: 'agent',
    },
    'terminal.backend': {
      type: 'select',
      description: 'Terminal execution backend',
      category: 'terminal',
      options: ['local', 'docker', 'ssh', 'modal', 'daytona', 'singularity'],
    },
    'terminal.docker_volumes': {
      type: 'list',
      description: 'Terminal → Docker Volumes',
      category: 'terminal',
    },
    // The live schema really does serve one field typed `bool`.
    'updates.refresh_cua_driver': {
      type: 'bool',
      description: 'Updates → Refresh Cua Driver',
      category: 'updates',
    },
    'security.tirith_enabled': {
      type: 'boolean',
      description: 'Enable the Tirith scanner',
      category: 'security',
    },
  },
}

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  resetSettingsStore()
})

describe('normalizeType', () => {
  it('passes the five documented types through', () => {
    for (const t of ['string', 'number', 'boolean', 'list', 'select']) {
      expect(normalizeType(t)).toBe(t)
    }
  })

  it('normalises the aliases the gateway actually emits', () => {
    expect(normalizeType('bool')).toBe('boolean')
    expect(normalizeType('int')).toBe('number')
    expect(normalizeType('array')).toBe('list')
  })

  /** An unknown type must degrade to the widget that cannot corrupt a value. */
  it('degrades anything unrecognised to string', () => {
    expect(normalizeType('quaternion')).toBe('string')
    expect(normalizeType(undefined)).toBe('string')
    expect(normalizeType(7)).toBe('string')
  })

  it('treats the presence of options as authoritative', () => {
    expect(normalizeType('string', true)).toBe('select')
  })
})

describe('orderCategories', () => {
  it('puts category_order first, then the rest alphabetically', () => {
    expect(
      orderCategories(['zeta', 'agent', 'alpha', 'general'], [
        'general',
        'agent',
        'terminal',
      ]),
    ).toEqual(['general', 'agent', 'alpha', 'zeta'])
  })

  it('never invents a category the fields do not use', () => {
    expect(orderCategories(['agent'], ['general', 'agent'])).toEqual(['agent'])
  })

  it('survives a missing category_order', () => {
    expect(orderCategories(['b', 'a'], undefined)).toEqual(['a', 'b'])
  })
})

describe('buildSchemaIndex', () => {
  it('prefixes every schema key into the store namespace', () => {
    const index = buildSchemaIndex(SCHEMA)
    expect(index.byKey.has('config.terminal.backend')).toBe(true)
    // The bare key is what the gateway published; it is never a store key.
    expect(index.byKey.has('terminal.backend')).toBe(false)
    expect(index.byKey.get('config.terminal.backend')?.schemaKey).toBe(
      'terminal.backend',
    )
  })

  /** The motivating example: the curated picker offers two of these six. */
  it('carries all six terminal backends', () => {
    const index = buildSchemaIndex(SCHEMA)
    expect(index.byKey.get('config.terminal.backend')?.options).toEqual([
      'local',
      'docker',
      'ssh',
      'modal',
      'daytona',
      'singularity',
    ])
  })

  it('groups by category in the published order', () => {
    const index = buildSchemaIndex(SCHEMA)
    expect(index.categories).toEqual([
      'general',
      'agent',
      'terminal',
      'security',
      'updates',
    ])
    expect(index.byCategory.get('terminal')?.map((f) => f.schemaKey)).toEqual([
      'terminal.backend',
      'terminal.docker_volumes',
    ])
  })

  it('normalises the one bool-typed field', () => {
    const index = buildSchemaIndex(SCHEMA)
    expect(index.byKey.get('config.updates.refresh_cua_driver')?.type).toBe(
      'boolean',
    )
  })

  // ── Degradation ───────────────────────────────────────────────────────
  it('returns an empty index rather than throwing on junk', () => {
    for (const junk of [undefined, null, {}, { fields: null }, { fields: [] }, 7]) {
      expect(buildSchemaIndex(junk).fields.length, String(junk)).toBe(0)
    }
  })

  it('skips a malformed field instead of losing the whole payload', () => {
    const index = buildSchemaIndex({
      fields: { good: { type: 'string' }, bad: null },
      category_order: [],
    })
    expect(index.fields.map((f) => f.schemaKey)).toEqual(['good'])
    expect(index.byKey.get('config.good')?.category).toBe('other')
  })
})

describe('widgetFor', () => {
  const select = buildSchemaIndex(SCHEMA).byKey.get('config.terminal.backend')!
  const bool = buildSchemaIndex(SCHEMA).byKey.get('config.security.tirith_enabled')!

  it('picks a select whenever options exist', () => {
    expect(widgetFor(select, 'local')).toBe('select')
  })

  it('falls back to the declared type when there is no value yet', () => {
    expect(widgetFor(bool, undefined)).toBe('boolean')
  })

  /**
   * The schema is derived from the gateway's defaults and is wrong in places —
   * `terminal.docker_network` is declared boolean but holds a network name. A
   * Toggle over a string would coerce it to `true` on the first click and write
   * that to the user's config, which is worse than a plain text box.
   */
  it('lets the live value overrule a wrong declared type', () => {
    expect(widgetFor(bool, 'bridge')).toBe('text')
    expect(widgetFor({ ...bool, type: 'boolean' }, 42)).toBe('number')
    expect(widgetFor({ ...bool, type: 'string' }, ['a'])).toBe('list')
  })

  it('degrades to text with neither a field nor a value', () => {
    expect(widgetFor(undefined, undefined)).toBe('text')
  })
})

describe('optionsFor', () => {
  const index = buildSchemaIndex(SCHEMA)
  const fallback = [{ value: 'local', label: 'Local' }]

  it('prefers the schema over the caller’s hardcoded list', () => {
    expect(optionsFor(index, 'config.terminal.backend', fallback)).toHaveLength(6)
  })

  /** This is what keeps a curated section working with the gateway down. */
  it('returns the fallback when the schema has nothing to say', () => {
    expect(optionsFor(index, 'config.nope', fallback)).toBe(fallback)
    expect(optionsFor(EMPTY_SCHEMA_INDEX, 'config.terminal.backend', fallback)).toBe(
      fallback,
    )
  })

  it('returns undefined when there is no fallback either', () => {
    expect(optionsFor(index, 'config.nope')).toBe(undefined)
  })
})

describe('humanizeKey', () => {
  it('reads the leaf, not the path', () => {
    expect(humanizeKey('config.terminal.docker_image')).toBe('Docker image')
    expect(humanizeKey('config.model')).toBe('Model')
  })
})

describe('useConfigSchema', () => {
  it('indexes the fetched schema', async () => {
    mockGetConfigSchema.mockResolvedValue(SCHEMA)
    const { result } = renderHook(() => useConfigSchema(), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.index.fields.length).toBe(6))
    expect(result.current.isError).toBe(false)
  })

  /**
   * The whole page must survive an old or absent gateway. Nothing here may
   * throw, suspend, or leave a caller without an options list.
   */
  it('degrades to an empty index when the request fails', async () => {
    mockGetConfigSchema.mockRejectedValue(new Error('404: Not Found'))
    const { result } = renderHook(() => useConfigSchema(), { wrapper: wrapper() })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.index.fields).toEqual([])
    expect(result.current.index.byKey.size).toBe(0)
    expect(
      optionsFor(result.current.index, 'config.terminal.backend', [
        { value: 'local', label: 'Local' },
      ]),
    ).toEqual([{ value: 'local', label: 'Local' }])
  })
})

describe('useSchemaDefaults / useRegisterSchemaDefaults', () => {
  it('flattens the bare defaults dict into config.* store keys', async () => {
    mockGetConfigDefaults.mockResolvedValue({ terminal: { timeout: 180 } })
    const { result } = renderHook(() => useSchemaDefaults(), { wrapper: wrapper() })

    await waitFor(() =>
      expect(result.current['config.terminal.timeout']).toBe(180),
    )
  })

  it('registers them without touching status, committed or dirty', async () => {
    mockGetConfigDefaults.mockResolvedValue({ terminal: { timeout: 180 } })
    renderHook(() => useRegisterSchemaDefaults(), { wrapper: wrapper() })

    await waitFor(() =>
      expect(useSettingsStore.getState().draft['config.terminal.timeout']).toBe(
        180,
      ),
    )
    const state = useSettingsStore.getState()
    expect(state.status).toBe('empty')
    expect(state.committed).toEqual({})
    expect(state.dirty.size).toBe(0)
  })

  it('never lets a default overwrite server truth or a live edit', async () => {
    useSettingsStore.getState().seed({ 'config.terminal.timeout': 90 })
    useSettingsStore.getState().set('config.terminal.timeout', 120)

    mockGetConfigDefaults.mockResolvedValue({ terminal: { timeout: 180 } })
    renderHook(() => useRegisterSchemaDefaults(), { wrapper: wrapper() })

    await waitFor(() =>
      expect(useSettingsStore.getState().defaults['config.terminal.timeout']).toBe(
        180,
      ),
    )
    expect(useSettingsStore.getState().draft['config.terminal.timeout']).toBe(120)
    expect(useSettingsStore.getState().committed['config.terminal.timeout']).toBe(90)
  })

  it('registers nothing when the endpoint is missing', async () => {
    mockGetConfigDefaults.mockRejectedValue(new Error('404: Not Found'))
    const { result } = renderHook(() => useSchemaDefaults(), { wrapper: wrapper() })

    await waitFor(() => expect(mockGetConfigDefaults).toHaveBeenCalled())
    expect(result.current).toEqual({})
    expect(useSettingsStore.getState().defaults).toEqual({})
  })
})
