import { describe, expect, it } from 'vitest'
import { compactTokens, formatUsageLabel } from './format-usage'

describe('format-usage', () => {
  it('compacts tokens by tier', () => {
    expect(formatUsageLabel(0, null)).toBe('—')
    expect(compactTokens(999)).toBe('999')
    expect(compactTokens(1000)).toBe('1.0k')
    expect(compactTokens(999_949)).toBe('999.9k')
    expect(compactTokens(999_999)).toBe('1.0M')
    expect(compactTokens(1_200_000)).toBe('1.2M')
  })
  it('formats cost', () => {
    expect(formatUsageLabel(1500, 0.004)).toBe('1.5k · <$0.01')
    expect(formatUsageLabel(1500, 0.034)).toBe('1.5k · $0.03')
    expect(formatUsageLabel(1500, null)).toBe('1.5k')
  })
})
