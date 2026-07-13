import { describe, expect, it } from 'vitest'

import { attachClarifyCard } from './tui-activity-card'
import type { TuiToolSection } from './tui-activity-card'

const section = (key: string, type: string): TuiToolSection => ({
  key,
  type,
  outputText: '',
  state: 'input-streaming',
})

describe('attachClarifyCard', () => {
  it('keeps clarify history and appends the interaction after later tools', () => {
    const card = { type: 'clarify-card' }
    const result = attachClarifyCard(
      [section('clarify-1', 'clarify'), section('exec-1', 'exec')],
      card,
      'input-streaming',
    )

    expect(result.map(({ key }) => key)).toEqual([
      'clarify-1',
      'exec-1',
      'inline-clarify-card',
    ])
    expect(result.filter(({ inlineContent }) => inlineContent === card)).toHaveLength(1)
  })

  it('attaches the interaction to the latest clarify when it is last', () => {
    const card = { type: 'clarify-card' }
    const result = attachClarifyCard(
      [section('clarify-1', 'clarify'), section('clarify-2', 'Clarify')],
      card,
      'input-streaming',
    )

    expect(result).toHaveLength(2)
    expect(result[0].inlineContent).toBeUndefined()
    expect(result[1].inlineContent).toBe(card)
  })

  it('adds one trailing clarify interaction when no clarify row exists', () => {
    const card = { type: 'clarify-card' }
    const result = attachClarifyCard(
      [section('exec-1', 'exec')],
      card,
      'output-available',
    )

    expect(result.map(({ key }) => key)).toEqual(['exec-1', 'inline-clarify-card'])
    expect(result[1]).toMatchObject({
      inlineContent: card,
      state: 'output-available',
    })
  })
})
