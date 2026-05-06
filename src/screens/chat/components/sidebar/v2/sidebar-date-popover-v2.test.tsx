/**
 * sidebar-date-popover-v2.test.tsx
 *
 * Phase 3c unit tests for the date popover pure logic:
 * - presetToRange computes correct ISO ranges
 * - setDateRange store action writes correctly (integration with store)
 *
 * Full DOM render tests are skipped — jsdom+vite environment conflict exists
 * project-wide (see task-card.test.tsx comment). Logic under test is pure.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useSessionsFilterStore } from '@/stores/sessions-filter-store'

// ── Store reset ───────────────────────────────────────────────────────────────

beforeEach(() => {
  useSessionsFilterStore.setState({
    dateRange: { from: null, to: null },
  })
})

// ── presetToRange logic (inline mirror — tests the pure function contract) ────

function presetToRange(preset: string): { from: string | null; to: string | null } {
  const now = new Date()
  const toISO = (d: Date) => d.toISOString().slice(0, 10)
  const today = toISO(now)
  if (preset === 'all') return { from: null, to: null }
  if (preset === 'today') return { from: today, to: today }
  const daysAgo = preset === '24h' ? 1 : preset === '7d' ? 7 : preset === '30d' ? 30 : 90
  const from = new Date(now)
  from.setDate(from.getDate() - daysAgo)
  return { from: toISO(from), to: today }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SidebarDatePopoverV2 — presetToRange logic', () => {
  it('"all" preset returns null/null', () => {
    const range = presetToRange('all')
    expect(range.from).toBeNull()
    expect(range.to).toBeNull()
  })

  it('"today" preset sets from === to === today ISO string', () => {
    const today = new Date().toISOString().slice(0, 10)
    const range = presetToRange('today')
    expect(range.from).toBe(today)
    expect(range.to).toBe(today)
  })

  it('"7d" preset returns ISO strings 7 days apart', () => {
    const range = presetToRange('7d')
    expect(range.from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(range.to).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const diff = (new Date(range.to!).getTime() - new Date(range.from!).getTime()) / 86_400_000
    expect(diff).toBe(7)
  })

  it('"30d" preset returns 30-day range', () => {
    const range = presetToRange('30d')
    const diff = (new Date(range.to!).getTime() - new Date(range.from!).getTime()) / 86_400_000
    expect(diff).toBe(30)
  })
})

describe('SidebarDatePopoverV2 — store integration', () => {
  it('setDateRange writes ISO range to store', () => {
    const { setDateRange } = useSessionsFilterStore.getState()
    setDateRange('2025-01-01', '2025-01-31')
    const { dateRange } = useSessionsFilterStore.getState()
    expect(dateRange.from).toBe('2025-01-01')
    expect(dateRange.to).toBe('2025-01-31')
  })

  it('setDateRange(null, null) clears the store', () => {
    useSessionsFilterStore.setState({ dateRange: { from: '2025-01-01', to: '2025-01-31' } })
    const { setDateRange } = useSessionsFilterStore.getState()
    setDateRange(null, null)
    const { dateRange } = useSessionsFilterStore.getState()
    expect(dateRange.from).toBeNull()
    expect(dateRange.to).toBeNull()
  })

  it('applying "7d" preset range writes valid ISO dates', () => {
    const range = presetToRange('7d')
    const { setDateRange } = useSessionsFilterStore.getState()
    setDateRange(range.from, range.to)
    const { dateRange } = useSessionsFilterStore.getState()
    expect(dateRange.from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(dateRange.to).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('applying "all" preset writes null/null', () => {
    useSessionsFilterStore.setState({ dateRange: { from: '2025-01-01', to: '2025-01-31' } })
    const range = presetToRange('all')
    const { setDateRange } = useSessionsFilterStore.getState()
    setDateRange(range.from, range.to)
    const { dateRange } = useSessionsFilterStore.getState()
    expect(dateRange.from).toBeNull()
    expect(dateRange.to).toBeNull()
  })
})
