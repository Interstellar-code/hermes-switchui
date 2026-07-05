import { beforeEach, describe, expect, it } from 'vitest'
import { inferPresetFromRange, presetToRange } from './sidebar-date-popover-v2'
import { buildDefaultDateRange, useSessionsFilterStore } from '@/stores/sessions-filter-store'

beforeEach(() => {
  useSessionsFilterStore.setState({ dateRange: buildDefaultDateRange() })
})

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

  it('infers the matching preset from a stored 7d range', () => {
    expect(inferPresetFromRange(presetToRange('7d'))).toBe('7d')
  })
})

describe('SidebarDatePopoverV2 — store integration', () => {
  it('default store dateRange is 7d', () => {
    expect(useSessionsFilterStore.getState().dateRange).toEqual(buildDefaultDateRange())
  })

  it('setDateRange writes ISO range to store', () => {
    const { setDateRange } = useSessionsFilterStore.getState()
    setDateRange('2025-01-01', '2025-01-31')
    const { dateRange } = useSessionsFilterStore.getState()
    expect(dateRange.from).toBe('2025-01-01')
    expect(dateRange.to).toBe('2025-01-31')
  })

  it('selected date range survives in the store for the session', () => {
    const { setDateRange } = useSessionsFilterStore.getState()
    setDateRange('2025-02-01', '2025-02-14')
    expect(useSessionsFilterStore.getState().dateRange).toEqual({ from: '2025-02-01', to: '2025-02-14' })
    expect(inferPresetFromRange(useSessionsFilterStore.getState().dateRange)).toBeNull()
  })

  it('setDateRange(null, null) clears the store', () => {
    const { setDateRange } = useSessionsFilterStore.getState()
    setDateRange(null, null)
    const { dateRange } = useSessionsFilterStore.getState()
    expect(dateRange.from).toBeNull()
    expect(dateRange.to).toBeNull()
  })
})
