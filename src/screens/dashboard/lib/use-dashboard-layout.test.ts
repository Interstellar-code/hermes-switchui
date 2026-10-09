// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_HIDDEN,
  STORAGE_KEY,
  STORAGE_VERSION,
  WIDGET_CATALOG,
  useDashboardLayout,
} from './use-dashboard-layout'
import type { WidgetId } from './use-dashboard-layout'

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

/**
 * Each test seeds a stored layout in the same key the hook reads, so
 * the migration runs against a real-shaped payload rather than a
 * mock. The hook's `hidden` set is then asserted directly through
 * the public API.
 */
function seedStored(value: unknown) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
}

describe('useDashboardLayout — read path / migrations', () => {
  beforeEach(() => {
    // Pin "now" to a fixed instant so anything that depends on
    // Date.now() in the hook stays stable. (The hook itself doesn't
    // use it, but future-leaning tests in this file might.)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-09T12:00:00Z'))
  })

  it('returns defaults when no stored value exists', () => {
    const { result } = renderHook(() => useDashboardLayout())
    const expected = new Set<WidgetId>(DEFAULT_HIDDEN)
    expect(new Set(result.current.hidden)).toEqual(expected)
  })

  it('keeps stored default-hidden ids when they still exist in the catalog', () => {
    seedStored({
      hidden: [
        'logs_tail',
        'provider_mix',
        'velocity',
        'cost_ledger',
        'operator_tip',
      ],
      version: STORAGE_VERSION,
    })
    const { result } = renderHook(() => useDashboardLayout())
    expect(result.current.hidden).toEqual(
      new Set<WidgetId>([
        'logs_tail',
        'provider_mix',
        'velocity',
        'cost_ledger',
        'operator_tip',
      ]),
    )
  })

  it("on v4 reads, keeps the user's hidden choices and unions the v5 defaults so the user's explicit hides carry over", () => {
    seedStored({
      hidden: ['mix_rhythm', 'provider_mix', 'velocity'],
      version: 4,
    })
    const { result } = renderHook(() => useDashboardLayout())
    const hidden = new Set(result.current.hidden)
    // User's stored choices are preserved.
    expect(hidden.has('mix_rhythm')).toBe(true)
    expect(hidden.has('provider_mix')).toBe(true)
    expect(hidden.has('velocity')).toBe(true)
    // v5 default-hides are unioned in for the existing v4 catalog.
    expect(hidden.has('logs_tail')).toBe(true)
    expect(hidden.has('operator_tip')).toBe(true)
    expect(hidden.has('cost_ledger')).toBe(true)
  })

  it('drops ids that are not in the current catalog and are not migrated', () => {
    // `bogus_widget` was never a real id. The hook should drop it
    // silently rather than crashing or surfacing it to the UI.
    seedStored({
      hidden: ['bogus_widget', 'logs_tail'],
      version: STORAGE_VERSION,
    })
    const { result } = renderHook(() => useDashboardLayout())
    const hidden = new Set<WidgetId>(result.current.hidden)
    // `result.current.hidden` is typed `Set<WidgetId>` so `.has()`
    // rejects raw strings; the cast to `unknown as WidgetId` is the
    // same shape the storage layer would see at runtime.
    expect(hidden.has('bogus_widget' as unknown as WidgetId)).toBe(false)
    expect(hidden.has('logs_tail')).toBe(true)
  })

  it('falls back to defaults when the stored value is not parseable JSON', () => {
    window.localStorage.setItem(STORAGE_KEY, 'not json at all')
    const { result } = renderHook(() => useDashboardLayout())
    expect(new Set(result.current.hidden)).toEqual(new Set(DEFAULT_HIDDEN))
  })

  it('falls back to defaults when `hidden` is missing or not an array AND the version is older than current', () => {
    // Without the union-with-defaults, an old-version entry with no
    // `hidden` would render the dashboard as if every widget were
    // visible — which is the wrong "first paint" for a returning
    // user whose widgets were already opted-out.
    seedStored({ version: 3 })
    const { result } = renderHook(() => useDashboardLayout())
    expect(new Set(result.current.hidden)).toEqual(new Set(DEFAULT_HIDDEN))
  })

  it('falls back to defaults when the stored version is older than the first migration and no ids are stored', () => {
    // v3 stored an empty hidden list with no ids. The migration
    // doesn't touch the array, so the union with DEFAULT_HIDDEN
    // produces the iteration-014 defaults — and the user shouldn't
    // see a flash of "show everything".
    seedStored({ hidden: [], version: 3 })
    const { result } = renderHook(() => useDashboardLayout())
    expect(new Set(result.current.hidden)).toEqual(new Set(DEFAULT_HIDDEN))
  })

  it('catalog is non-empty and every default-hidden id is present', () => {
    expect(WIDGET_CATALOG.length).toBeGreaterThan(0)
    const ids = new Set(WIDGET_CATALOG.map((w) => w.id))
    for (const id of DEFAULT_HIDDEN) {
      expect(ids.has(id)).toBe(true)
    }
  })
})

describe('useDashboardLayout — write path', () => {
  it('persists the current `hidden` set on change with the new version', () => {
    const { result } = renderHook(() => useDashboardLayout())
    act(() => result.current.hide('analytics_chart'))
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')
    expect(stored.version).toBe(STORAGE_VERSION)
    expect(stored.hidden).toContain('analytics_chart')
  })

  it('reset returns to the iteration-014 defaults', () => {
    seedStored({
      hidden: ['analytics_chart', 'top_models'],
      version: STORAGE_VERSION,
    })
    const { result } = renderHook(() => useDashboardLayout())
    expect(result.current.hidden.has('analytics_chart')).toBe(true)
    act(() => result.current.reset())
    expect(new Set(result.current.hidden)).toEqual(new Set(DEFAULT_HIDDEN))
  })

  it('isVisible reflects the current `hidden` set', () => {
    const { result } = renderHook(() => useDashboardLayout())
    expect(result.current.isVisible('analytics_chart')).toBe(true)
    act(() => result.current.hide('analytics_chart'))
    expect(result.current.isVisible('analytics_chart')).toBe(false)
    act(() => result.current.show('analytics_chart'))
    expect(result.current.isVisible('analytics_chart')).toBe(true)
  })

  it('counts always sum to the catalog size', () => {
    const { result } = renderHook(() => useDashboardLayout())
    expect(result.current.counts.visible + result.current.counts.hidden).toBe(
      WIDGET_CATALOG.length,
    )
  })
})
