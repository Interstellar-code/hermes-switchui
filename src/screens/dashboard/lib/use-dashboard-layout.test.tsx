// @vitest-environment jsdom
import { act, render, renderHook } from '@testing-library/react'
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

  it("preserves the user's explicit SHOWN choices on a same-version read (no version bump)", () => {
    // The round-1 review's high-severity finding: a version bump
    // would re-hide anything the user explicitly showed. With no
    // bump, the plain `filtered` path keeps the stored value as-is.
    seedStored({
      hidden: ['logs_tail', 'operator_tip', 'cost_ledger'],
      version: STORAGE_VERSION,
    })
    const { result } = renderHook(() => useDashboardLayout())
    const hidden = new Set(result.current.hidden)
    // User explicitly SHOWED provider_mix, velocity.
    expect(hidden.has('provider_mix')).toBe(false)
    expect(hidden.has('velocity')).toBe(false)
    // User kept the rest hidden.
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

  it('falls back to defaults when the stored version is a non-number', () => {
    // A future build that wrote a string version, or a corrupted
    // entry, would otherwise be treated as current and load with
    // a half-migrated set. The safer choice is to start clean.
    seedStored({ hidden: ['logs_tail'], version: 'v4' })
    const { result } = renderHook(() => useDashboardLayout())
    expect(new Set(result.current.hidden)).toEqual(new Set(DEFAULT_HIDDEN))
  })

  it('falls back to defaults when the stored version is missing', () => {
    seedStored({ hidden: ['logs_tail'] })
    const { result } = renderHook(() => useDashboardLayout())
    expect(new Set(result.current.hidden)).toEqual(new Set(DEFAULT_HIDDEN))
  })

  it('falls back to defaults when the stored version is from a future build', () => {
    // A returning user with a higher-numbered version than we
    // know about — defensive, in case a future build gets
    // uninstalled and the user rolls back to an earlier release.
    seedStored({ hidden: ['logs_tail'], version: STORAGE_VERSION + 5 })
    const { result } = renderHook(() => useDashboardLayout())
    expect(new Set(result.current.hidden)).toEqual(new Set(DEFAULT_HIDDEN))
  })

  it("preserves the user's empty hidden list from an older version (no union-with-defaults bump)", () => {
    // A user who stored `hidden: []` at v3 — i.e. explicitly chose
    // to show every widget — keeps that choice on a v4 read. The
    // round-1 union-with-defaults behaviour would have re-hidden
    // widgets they explicitly opted into; the r2 spec drops the
    // version bump so the plain `filtered` path is correct.
    seedStored({ hidden: [], version: 3 })
    const { result } = renderHook(() => useDashboardLayout())
    expect(new Set(result.current.hidden)).toEqual(new Set<WidgetId>())
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
  it('persists the current `hidden` set on change with the current version', () => {
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

describe('useDashboardLayout — cross-instance sync', () => {
  // The round-1 review flagged a "two `useDashboardLayout()`
  // instances writing one key" bug: each kept its own `useState`
  // and the last writer won. The fix is a module-level subscriber
  // fan-out — every instance listens, every write notifies.
  it('two instances in the same tab stay in sync', () => {
    // Two independent renderHook calls share the same module-level
    // subscriber set, so a write in one is observed by the other.
    const a = renderHook(() => useDashboardLayout())
    const b = renderHook(() => useDashboardLayout())
    // Both start with the same defaults.
    expect(new Set(a.result.current.hidden)).toEqual(
      new Set(b.result.current.hidden),
    )
    // A's hide() must propagate to B on the next render.
    act(() => a.result.current.hide('provider_mix'))
    expect(a.result.current.hidden.has('provider_mix')).toBe(true)
    expect(b.result.current.hidden.has('provider_mix')).toBe(true)
    // B's show() must propagate back to A.
    act(() => b.result.current.show('provider_mix'))
    expect(a.result.current.hidden.has('provider_mix')).toBe(false)
    expect(b.result.current.hidden.has('provider_mix')).toBe(false)
  })

  it('cross-instance sync survives two components in the same render tree', () => {
    // Closer to the real scenario: the legacy screen renders a
    // `WidgetShell` and the new ops section calls `useDashboardLayout`
    // again. Both must reflect the same visibility set.
    function Probe({
      id,
      onReady,
    }: {
      id: string
      onReady: (layout: ReturnType<typeof useDashboardLayout>) => void
    }) {
      const layout = useDashboardLayout()
      // Surface the latest layout to the test on every render via a
      // ref-like side effect.
      onReady(layout)
      return (
        <span data-probe={id}>
          {layout.isVisible('provider_mix') ? 'Y' : 'N'}
        </span>
      )
    }
    let aLayout: ReturnType<typeof useDashboardLayout> | null = null
    let bLayout: ReturnType<typeof useDashboardLayout> | null = null
    render(
      <>
        <Probe
          id="a"
          onReady={(layout) => {
            aLayout = layout
          }}
        />
        <Probe
          id="b"
          onReady={(layout) => {
            bLayout = layout
          }}
        />
      </>,
    )
    // Both probes see the same default-visible state for
    // provider_mix (it's in DEFAULT_HIDDEN, so the user-facing
    // `isVisible()` returns false).
    expect(aLayout).not.toBeNull()
    expect(bLayout).not.toBeNull()
    act(() => {
      // Use A's `show` to flip provider_mix to visible.
      ;(aLayout as unknown as { show: (id: WidgetId) => void }).show(
        'provider_mix',
      )
    })
    // B re-renders and reflects the change.
    expect(
      (bLayout as unknown as { hidden: Set<WidgetId> }).hidden.has(
        'provider_mix',
      ),
    ).toBe(false)
  })
})
