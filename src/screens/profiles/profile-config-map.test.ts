import { describe, expect, it } from 'vitest'

import { INITIAL_DRAFT } from './types'
import {
  configPreviewFromDraft,
  diffLines,
  draftFromConfig,
  predictMergedConfig,
  resolveDescription,
} from './profile-config-map'
import type { NewAgentDraft } from './types'
import type { ProfileConfig } from '@/server/profiles-browser'

function draft(patch: Partial<NewAgentDraft> = {}): NewAgentDraft {
  return { ...INITIAL_DRAFT, ...patch }
}

// ── resolveDescription ──────────────────────────────────────────────────────

describe('resolveDescription', () => {
  it('prefers the draft description when present', () => {
    expect(
      resolveDescription({ description: 'A helpful blurb', role: 'Role', name: 'agent-1' }),
    ).toBe('A helpful blurb')
  })

  it('falls back to role when description is genuinely empty', () => {
    expect(resolveDescription({ description: '', role: 'Role', name: 'agent-1' })).toBe('Role')
  })

  it('falls back to role when description is only whitespace', () => {
    expect(resolveDescription({ description: '   \n  ', role: 'Role', name: 'agent-1' })).toBe(
      'Role',
    )
  })

  it('falls back to name when both description and role are empty', () => {
    expect(resolveDescription({ description: '', role: '', name: 'agent-1' })).toBe('agent-1')
  })
})

// ── draftFromConfig / configPreviewFromDraft round-trip ─────────────────────

describe('draftFromConfig — role/description independence (P-08)', () => {
  it('hydrates role and description from their own independent config fields', () => {
    const config: ProfileConfig = {
      description: 'The long-form blurb',
      agent_ui: { role: 'Short Role' },
    }
    const d = draftFromConfig('agent-1', config)
    expect(d.role).toBe('Short Role')
    expect(d.description).toBe('The long-form blurb')
  })

  it('does NOT fall back role to config.description (the old conflation bug)', () => {
    const config: ProfileConfig = {
      description: 'Only a description, no agent_ui.role',
    }
    const d = draftFromConfig('agent-1', config)
    expect(d.role).toBe('')
    expect(d.description).toBe('Only a description, no agent_ui.role')
  })

  it('leaves both empty when neither is set on disk', () => {
    const config: ProfileConfig = {}
    const d = draftFromConfig('agent-1', config)
    expect(d.role).toBe('')
    expect(d.description).toBe('')
  })
})

describe('configPreviewFromDraft — description emission', () => {
  it('emits the draft description verbatim when present', () => {
    const obj = configPreviewFromDraft(draft({ name: 'agent-1', role: 'Role', description: 'Blurb' }))
    expect(obj.description).toBe('Blurb')
  })

  it('falls back to role || name only when description is genuinely empty', () => {
    const obj = configPreviewFromDraft(draft({ name: 'agent-1', role: 'Role', description: '' }))
    expect(obj.description).toBe('Role')

    const objNoRole = configPreviewFromDraft(draft({ name: 'agent-1', role: '', description: '' }))
    expect(objNoRole.description).toBe('agent-1')
  })

  it('round-trips independently: description and role survive a full cycle unmerged', () => {
    const original = draft({
      name: 'agent-1',
      glyph: 'AB',
      role: 'Short Role',
      description: 'Long blurb that must not become the role',
    })
    const previewed = configPreviewFromDraft(original) as ProfileConfig
    const hydrated = draftFromConfig('agent-1', previewed)
    expect(hydrated.role).toBe(original.role)
    expect(hydrated.description).toBe(original.description)
  })
})

// ── predictMergedConfig (deep-merge caveat) ──────────────────────────────────

describe('predictMergedConfig', () => {
  it('preserves agent_ui fields the wizard never sends (tier, status)', () => {
    const current: ProfileConfig = {
      agent_ui: { tier: 2, status: 'active', role: 'Old Role', glyph: 'AB', tags: [] },
    }
    const merged = predictMergedConfig(current, draft({ role: 'New Role', glyph: 'CD' }))
    const agentUi = merged.agent_ui as Record<string, unknown>
    expect(agentUi.tier).toBe(2)
    expect(agentUi.status).toBe('active')
    expect(agentUi.role).toBe('New Role')
    expect(agentUi.glyph).toBe('CD')
  })

  it('preserves unrelated top-level keys the wizard does not model', () => {
    const current: ProfileConfig = { hooks: { pre: 'do-thing' } }
    const merged = predictMergedConfig(current, draft())
    expect(merged.hooks).toEqual({ pre: 'do-thing' })
  })

  it('replaces mcp_servers wholesale rather than merging keys', () => {
    const current: ProfileConfig = {
      mcp_servers: { keep: { url: 'https://a' }, drop: { url: 'https://b' } },
    }
    const merged = predictMergedConfig(
      current,
      draft({ mcp_servers: { keep: { url: 'https://a-updated' } } }),
    )
    expect(merged.mcp_servers).toEqual({ keep: { url: 'https://a-updated' } })
  })

  it('deep-merges memory rather than replacing the whole object', () => {
    const current: ProfileConfig = {
      memory: { memory_enabled: true, provider: 'hindsight' },
    }
    const merged = predictMergedConfig(
      current,
      draft({ memory_enabled: false, memory_provider: '' }),
    )
    expect(merged.memory).toEqual({ memory_enabled: false, provider: '' })
  })
})

// ── diffLines ─────────────────────────────────────────────────────────────────

describe('diffLines', () => {
  it('reports no added/removed lines for identical input', () => {
    const text = 'a\nb\nc'
    const lines = diffLines(text, text)
    expect(lines.every((l) => l.type === 'unchanged')).toBe(true)
    expect(lines.map((l) => l.text)).toEqual(['a', 'b', 'c'])
  })

  it('detects a pure addition', () => {
    const lines = diffLines('a\nb', 'a\nb\nc')
    expect(lines).toEqual([
      { type: 'unchanged', text: 'a' },
      { type: 'unchanged', text: 'b' },
      { type: 'added', text: 'c' },
    ])
  })

  it('detects a pure removal', () => {
    const lines = diffLines('a\nb\nc', 'a\nc')
    expect(lines).toEqual([
      { type: 'unchanged', text: 'a' },
      { type: 'removed', text: 'b' },
      { type: 'unchanged', text: 'c' },
    ])
  })

  it('represents a changed line as a removal + addition pair', () => {
    const lines = diffLines('role: Old', 'role: New')
    expect(lines).toEqual([
      { type: 'removed', text: 'role: Old' },
      { type: 'added', text: 'role: New' },
    ])
  })
})
