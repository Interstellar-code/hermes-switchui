import { describe, expect, it } from 'vitest'
import { normalizeClarifyChoices } from './clarify-choices'

describe('normalizeClarifyChoices', () => {
  it('normalizes string and supported object choices', () => {
    expect(normalizeClarifyChoices([
      ' First ',
      { content: 'Second' },
      { label: 'Third', description: 'ignored' },
      { description: 'Fourth' },
    ])).toEqual(['First', 'Second', 'Third', 'Fourth'])
  })

  it('returns null when no valid choices exist', () => {
    expect(normalizeClarifyChoices([{ value: 'raw' }, '', null])).toBeNull()
  })
})
