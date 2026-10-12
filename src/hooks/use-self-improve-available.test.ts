import { describe, expect, it } from 'vitest'
import {
  isSelfImprovePluginActive,
  selfImproveQueryOptions,
} from './use-self-improve-available'

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

describe('selfImproveQueryOptions', () => {
  it('polls at a relaxed 5-minute cadence', () => {
    expect(selfImproveQueryOptions.refetchInterval).toBe(300_000)
    expect(selfImproveQueryOptions.staleTime).toBe(300_000)
  })

  it('does not poll while the tab is hidden', () => {
    expect(selfImproveQueryOptions.refetchIntervalInBackground).toBe(false)
  })
})
