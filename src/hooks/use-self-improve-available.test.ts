import { describe, expect, it } from 'vitest'
import { isSelfImprovePluginActive } from './use-self-improve-available'

describe('isSelfImprovePluginActive', () => {
  it.each([
    ['is absent', [], false],
    [
      'is absent from the live enabled-plugin list',
      ['hermes-switch-ui'],
      false,
    ],
    ['is enabled', ['karpathy-self-improve'], true],
    [
      'is enabled alongside other plugins',
      ['hermes-switch-ui', 'karpathy-self-improve'],
      true,
    ],
    ['handles an unavailable runtime list', null, false],
  ])('%s', (_case, plugins, expected) => {
    expect(isSelfImprovePluginActive(plugins)).toBe(expected)
  })
})
