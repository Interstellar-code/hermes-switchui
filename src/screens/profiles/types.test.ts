import { describe, expect, it } from 'vitest'

import { INITIAL_DRAFT, validateStep } from './types'
import type { NewAgentDraft } from './types'

function draft(patch: Partial<NewAgentDraft> = {}): NewAgentDraft {
  return { ...INITIAL_DRAFT, ...patch }
}

describe('validateStep — step 1 (Identity)', () => {
  it.each([
    ['ab', true],
    ['agent-1', true],
    ['a', false], // too short
    ['Agent', false], // uppercase not allowed
    ['agent_one', false], // underscore not allowed
    ['a'.repeat(41), false], // too long
  ])('name %s → valid=%s', (name, valid) => {
    const errs = validateStep(1, draft({ name, glyph: 'AB', role: 'role' }), [])
    const nameErrs = errs.filter((e) => e.includes('2–40 lowercase'))
    expect(nameErrs.length === 0).toBe(valid)
  })

  it('rejects a name already in use', () => {
    const errs = validateStep(1, draft({ name: 'taken', glyph: 'AB', role: 'role' }), ['taken'])
    expect(errs).toContain('Name "taken" is already in use')
  })

  it('exempts editName from the duplicate-name check', () => {
    const errs = validateStep(
      1,
      draft({ name: 'taken', glyph: 'AB', role: 'role' }),
      ['taken'],
      'taken',
    )
    expect(errs).not.toContain('Name "taken" is already in use')
  })

  it.each([
    ['A', true],
    ['AB', true],
    ['ABC', true],
    ['1', true],
    ['ABCD', false], // too long
    ['ab', false], // lowercase not allowed
    ['', false], // required
  ])('glyph %s → valid=%s', (glyph, valid) => {
    const errs = validateStep(1, draft({ name: 'agent-1', glyph, role: 'role' }), [])
    const glyphErrs = errs.filter((e) => e.includes('Glyph must be'))
    expect(glyphErrs.length === 0).toBe(valid)
  })

  it('requires a role', () => {
    const errs = validateStep(1, draft({ name: 'agent-1', glyph: 'AB', role: '' }), [])
    expect(errs).toContain('Role is required')
  })

  it('rejects a role over 80 characters', () => {
    const errs = validateStep(
      1,
      draft({ name: 'agent-1', glyph: 'AB', role: 'x'.repeat(81) }),
      [],
    )
    expect(errs).toContain('Role must be ≤80 characters')
  })

  it('passes with all valid identity fields', () => {
    const errs = validateStep(1, draft({ name: 'agent-1', glyph: 'AB', role: 'role' }), [])
    expect(errs).toEqual([])
  })

  it('does not require a description — it is optional (P-08)', () => {
    const errs = validateStep(
      1,
      draft({ name: 'agent-1', glyph: 'AB', role: 'role', description: '' }),
      [],
    )
    expect(errs).toEqual([])
  })

  it('accepts a long multi-line description without erroring', () => {
    const errs = validateStep(
      1,
      draft({
        name: 'agent-1',
        glyph: 'AB',
        role: 'role',
        description: 'Line one.\nLine two.\n'.repeat(20),
      }),
      [],
    )
    expect(errs).toEqual([])
  })
})

describe('validateStep — step 2 (Persona)', () => {
  it('requires a persona in create mode', () => {
    const errs = validateStep(2, draft({ persona_id: null, system_prompt: 'hello' }), [])
    expect(errs).toContain('Please select a persona')
  })

  it('does not require a persona in edit mode', () => {
    const errs = validateStep(
      2,
      draft({ persona_id: null, system_prompt: 'hello' }),
      [],
      'existing-agent',
    )
    expect(errs).not.toContain('Please select a persona')
  })

  it('always requires a non-empty system prompt', () => {
    const createErrs = validateStep(2, draft({ persona_id: 'default', system_prompt: '   ' }), [])
    expect(createErrs).toContain('System prompt is required')

    const editErrs = validateStep(
      2,
      draft({ persona_id: null, system_prompt: '   ' }),
      [],
      'existing-agent',
    )
    expect(editErrs).toContain('System prompt is required')
  })

  it('passes with persona and system prompt set', () => {
    const errs = validateStep(2, draft({ persona_id: 'default', system_prompt: 'hello' }), [])
    expect(errs).toEqual([])
  })
})

describe('validateStep — step 3 (Model)', () => {
  it('requires a model', () => {
    const errs = validateStep(3, draft({ model: '', provider: 'openai' }), [])
    expect(errs).toContain('Model is required')
  })

  it('requires a provider', () => {
    const errs = validateStep(3, draft({ model: 'gpt-5', provider: '' }), [])
    expect(errs).toContain('Provider is required')
  })

  it('passes when both model and provider are set', () => {
    const errs = validateStep(3, draft({ model: 'gpt-5', provider: 'openai' }), [])
    expect(errs).toEqual([])
  })
})

describe('validateStep — step 7 (Memory)', () => {
  it('passes when memory is enabled with a real provider (regression for P-01)', () => {
    const errs = validateStep(
      7,
      draft({ memory_enabled: true, memory_provider: 'matrix-memory' }),
      [],
    )
    expect(errs).toEqual([])
  })

  it('errors when memory is enabled but no provider is selected', () => {
    const errs = validateStep(7, draft({ memory_enabled: true, memory_provider: '' }), [])
    expect(errs).toContain('Memory provider is required when memory is enabled')
  })

  it('passes when memory is disabled, regardless of provider', () => {
    const errs = validateStep(
      7,
      draft({ memory_enabled: false, memory_provider: '' }),
      [],
    )
    expect(errs).toEqual([])
  })
})

describe('validateStep — step 9 (Review, re-runs 1, 2, 3, 7)', () => {
  const validBase: NewAgentDraft = draft({
    name: 'agent-1',
    glyph: 'AB',
    role: 'role',
    persona_id: 'default',
    system_prompt: 'hello',
    model: 'gpt-5',
    provider: 'openai',
  })

  it('does not surface a memory error for a fully-valid draft with memory enabled', () => {
    const errs = validateStep(
      9,
      { ...validBase, memory_enabled: true, memory_provider: 'matrix-memory' },
      [],
    )
    expect(errs).toEqual([])
  })

  it('surfaces the memory error when memory is enabled without a provider', () => {
    const errs = validateStep(
      9,
      { ...validBase, memory_enabled: true, memory_provider: '' },
      [],
    )
    expect(errs).toContain('Memory provider is required when memory is enabled')
  })

  it('surfaces errors from steps 1, 2, and 3 when they are invalid', () => {
    const errs = validateStep(
      9,
      draft({ name: '', glyph: '', role: '', persona_id: null, system_prompt: '', model: '', provider: '' }),
      [],
    )
    expect(errs).toContain('Name must be 2–40 lowercase letters, numbers, or hyphens')
    expect(errs).toContain('Glyph must be 1–3 uppercase letters or digits')
    expect(errs).toContain('Role is required')
    expect(errs).toContain('Please select a persona')
    expect(errs).toContain('System prompt is required')
    expect(errs).toContain('Model is required')
    expect(errs).toContain('Provider is required')
  })
})
