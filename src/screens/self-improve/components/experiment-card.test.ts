import { describe, expect, it } from 'vitest'
import { applyErrorMessage, effectBadgeLabel } from './experiment-card'

describe('effectBadgeLabel', () => {
  it('labels 1 and null as next session, 0 as live now', () => {
    expect(effectBadgeLabel(1)).toBe('Takes effect on next session')
    expect(effectBadgeLabel(null)).toBe('Takes effect on next session')
    expect(effectBadgeLabel(0)).toBe('Live now')
  })
})

describe('applyErrorMessage', () => {
  it('returns the patch-conflict copy for a 422 error', () => {
    const err = Object.assign(new Error('ignored'), { status: 422 })
    expect(applyErrorMessage(err)).toBe('Patch failed — experiment not applied')
  })

  it('falls back to the error message for a non-422 error', () => {
    const err = Object.assign(new Error('boom'), { status: 500 })
    expect(applyErrorMessage(err)).toBe('boom')
  })

  it('falls back to a generic message for non-Error values', () => {
    expect(applyErrorMessage('nope')).toBe('Apply failed')
  })
})
