// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  ComposerContextRing,
  formatContextUsage,
  formatTokenK,
} from './composer-context-ring'

describe('formatTokenK', () => {
  it('formats thousands to k notation', () => {
    expect(formatTokenK(42000)).toBe('42k')
    expect(formatTokenK(200000)).toBe('200k')
    expect(formatTokenK(158000)).toBe('158k')
    expect(formatTokenK(950)).toBe('950')
  })

  it('formats millions to M notation', () => {
    expect(formatTokenK(1000000)).toBe('1M')
    expect(formatTokenK(1500000)).toBe('1.5M')
  })
})

describe('formatContextUsage', () => {
  it('formats exactly as expected by spec: 21% used · 42k / 200k tokens · 158k left', () => {
    const result = formatContextUsage(42000, 200000)
    expect(result).not.toBeNull()
    expect(result?.percent).toBe(21)
    expect(result?.label).toBe('21% used · 42k / 200k tokens · 158k left')
  })

  it('returns null when maxTokens is invalid or <= 0', () => {
    expect(formatContextUsage(100, 0)).toBeNull()
    expect(formatContextUsage(100, -50)).toBeNull()
    expect(formatContextUsage(100, undefined)).toBeNull()
    expect(formatContextUsage(100, null)).toBeNull()
  })

  it('handles 0 used tokens safely', () => {
    const result = formatContextUsage(0, 100000)
    expect(result?.percent).toBe(0)
    expect(result?.label).toBe('0% used · 0 / 100k tokens · 100k left')
  })

  it('caps percent at 100% when used exceeds max', () => {
    const result = formatContextUsage(210000, 200000)
    expect(result?.percent).toBe(100)
    expect(result?.leftFormatted).toBe('0')
  })
})

describe('ComposerContextRing', () => {
  it('renders progress ring and percentage', () => {
    render(<ComposerContextRing usedTokens={42000} maxTokens={200000} />)
    const element = screen.getByTestId('composer-context-ring')
    expect(element).toBeDefined()
    expect(element.getAttribute('title')).toBe(
      '21% used · 42k / 200k tokens · 158k left',
    )
    expect(element.textContent).toContain('21%')
  })

  it('renders nothing when maxTokens is zero or missing', () => {
    const { container } = render(<ComposerContextRing usedTokens={100} maxTokens={0} />)
    expect(container.firstChild).toBeNull()
  })
})
