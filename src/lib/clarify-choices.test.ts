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

  it('falls back to a readable value when Hermes omits the label', () => {
    expect(normalizeClarifyChoices([{ value: 'top10_only' }, '', null])).toEqual([
      'top10 only',
    ])
  })

  it('returns null when no valid choices exist', () => {
    expect(normalizeClarifyChoices([{}, '', null])).toBeNull()
  })

  it('uses a descriptive object key when Hermes emits keyed choices', () => {
    expect(
      normalizeClarifyChoices([
        { 'Copy the top 10 books': '', value: 'top10_only' },
        { 'Copy the full curated list': '', value: 'full_list' },
      ]),
    ).toEqual(['Copy the top 10 books', 'Copy the full curated list'])
  })
})
