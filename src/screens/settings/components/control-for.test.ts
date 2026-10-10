import { describe, expect, it } from 'vitest'
import { controlFor } from './control-for'
import type { KeyMeta } from '../lib/key-meta-types'

/** Minimal valid KeyMeta with the fields under test overridden. */
function meta(overrides: Partial<KeyMeta>): KeyMeta {
  return {
    id: 'test.key',
    label: 'Test key',
    group: 'test-group',
    scope: 'hermes-config',
    applies: 'live',
    type: 'string',
    effect: 'does something',
    source: 'agent/config.py',
    verified: true,
    ...overrides,
  }
}

describe('controlFor', () => {
  it('maps every scalar KeyMeta.type to its control kind', () => {
    expect(controlFor(meta({ type: 'bool' }))).toBe('toggle')
    expect(controlFor(meta({ type: 'enum', options: ['a', 'b'] }))).toBe(
      'select',
    )
    expect(controlFor(meta({ type: 'string' }))).toBe('text')
    expect(controlFor(meta({ type: 'secret' }))).toBe('password')
    expect(controlFor(meta({ type: 'list' }))).toBe('raw')
    expect(controlFor(meta({ type: 'map' }))).toBe('raw')
  })

  it('uses a slider for int/float only when both range bounds exist', () => {
    expect(controlFor(meta({ type: 'int', range: { min: 1, max: 500 } }))).toBe(
      'slider',
    )
    expect(controlFor(meta({ type: 'float', range: { min: 0, max: 1 } }))).toBe(
      'slider',
    )
    // min=0 is a real bound, not a missing one — falsy checks would misroute it.
    expect(controlFor(meta({ type: 'int', range: { min: 0, max: 10 } }))).toBe(
      'slider',
    )

    expect(controlFor(meta({ type: 'int' }))).toBe('number')
    expect(controlFor(meta({ type: 'float' }))).toBe('number')
    expect(controlFor(meta({ type: 'int', range: { min: 1 } }))).toBe('number')
    expect(controlFor(meta({ type: 'int', range: { max: 500 } }))).toBe(
      'number',
    )
  })

  it('keeps a bounded range a slider even when it also has an unlimited sentinel', () => {
    // agent.max_turns shape: 1–500 but null means ∞. The bounds are real, so
    // the slider stays; the ∞ escape is a separate concern (P2B).
    expect(
      controlFor(
        meta({ type: 'int', range: { min: 1, max: 500, unlimited: null } }),
      ),
    ).toBe('slider')
  })
})
