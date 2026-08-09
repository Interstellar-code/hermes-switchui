import { describe, expect, it } from 'vitest'

import {
  REPLACE_WHOLE_CONFIG_KEYS,
  deepMerge,
  mergeProfileConfig,
} from './profile-merge'

describe('deepMerge', () => {
  it('recurses into nested plain objects, adding and overwriting keys', () => {
    const target: Record<string, unknown> = {
      agent_ui: { tier: 3, status: 'active', tags: ['a'] },
    }
    deepMerge(target, { agent_ui: { glyph: 'AB', tags: ['b'] } })
    expect(target).toEqual({
      agent_ui: { tier: 3, status: 'active', glyph: 'AB', tags: ['b'] },
    })
  })

  it('overwrites arrays wholesale rather than merging elements', () => {
    const target: Record<string, unknown> = { tags: ['a', 'b'] }
    deepMerge(target, { tags: ['c'] })
    expect(target.tags).toEqual(['c'])
  })

  it('overwrites a primitive with a plain object', () => {
    const target: Record<string, unknown> = { description: 'old' }
    deepMerge(target, { description: 'new' })
    expect(target.description).toBe('new')
  })

  it('adds a brand-new top-level key untouched by target', () => {
    const target: Record<string, unknown> = {}
    deepMerge(target, { skills: { external_dirs: ['/x'] } })
    expect(target).toEqual({ skills: { external_dirs: ['/x'] } })
  })
})

describe('mergeProfileConfig', () => {
  it('treats null patch values as explicit deletions', () => {
    const current: Record<string, unknown> = {
      description: 'keep me gone',
      model: { default: 'auto' },
    }
    const result = mergeProfileConfig(current, { description: null })
    expect('description' in result).toBe(false)
    expect(result.model).toEqual({ default: 'auto' })
  })

  it('replaces REPLACE_WHOLE_CONFIG_KEYS wholesale instead of merging', () => {
    expect(REPLACE_WHOLE_CONFIG_KEYS).toEqual(['mcp_servers'])
    const current: Record<string, unknown> = {
      mcp_servers: {
        alpha: { command: 'alpha-cmd' },
        bravo: { command: 'bravo-cmd' },
      },
    }
    const result = mergeProfileConfig(current, {
      mcp_servers: { alpha: { command: 'alpha-cmd-v2' } },
    })
    // bravo is gone — a deep merge could never drop it.
    expect(result.mcp_servers).toEqual({ alpha: { command: 'alpha-cmd-v2' } })
  })

  it('null-then-replace-whole: `{ mcp_servers: null }` deletes rather than "replacing with null"', () => {
    const current: Record<string, unknown> = {
      mcp_servers: { alpha: { command: 'alpha-cmd' } },
    }
    const result = mergeProfileConfig(current, { mcp_servers: null })
    expect('mcp_servers' in result).toBe(false)
  })

  it('deep-merges agent_ui so tier/status survive a patch that omits them', () => {
    const current: Record<string, unknown> = {
      agent_ui: { tier: 3, status: 'active', glyph: 'A4', tags: ['initial'] },
    }
    const result = mergeProfileConfig(current, {
      agent_ui: { glyph: 'B4', tags: ['updated'] },
    })
    expect(result.agent_ui).toEqual({
      tier: 3,
      status: 'active',
      glyph: 'B4',
      tags: ['updated'],
    })
  })

  it('mutates and returns the same `current` object', () => {
    const current: Record<string, unknown> = { description: 'x' }
    const result = mergeProfileConfig(current, { description: 'y' })
    expect(result).toBe(current)
  })
})
