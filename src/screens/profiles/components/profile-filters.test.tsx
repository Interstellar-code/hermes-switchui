// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React, { act, useCallback, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ProfileFilters, SEARCH_DEBOUNCE_MS } from './profile-filters'
import type { ProfileFilterState } from '@/stores/profiles-screen-store'
import { DEFAULT_FILTERS, applyFilterPatch } from '@/stores/profiles-screen-store'

const roots: Array<ReturnType<typeof createRoot>> = []

type Change = [Partial<ProfileFilterState>, { replace?: boolean } | undefined]

function render(
  filters: Partial<ProfileFilterState> = {},
  onFilterChange: (
    patch: Partial<ProfileFilterState>,
    opts?: { replace?: boolean },
  ) => void = () => {},
): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(
      <ProfileFilters
        models={[]}
        tags={[]}
        filters={{ ...DEFAULT_FILTERS, ...filters }}
        onFilterChange={onFilterChange}
      />,
    )
  })
  return container
}

/**
 * The screen feeds the filters straight back from the URL it just wrote, so a
 * harness that only records patches would test a component that never sees its
 * own writes land. This one applies them, exactly as the round trip does.
 */
function renderControlled(initial: Partial<ProfileFilterState> = {}): {
  container: HTMLElement
  changes: Array<Change>
} {
  const changes: Array<Change> = []
  function Harness() {
    const [filters, setFilters] = useState<ProfileFilterState>({
      ...DEFAULT_FILTERS,
      ...initial,
    })
    // Stable, like the screen's `useCallback` writer — an identity that changed
    // every render would restart the debounce timer forever.
    const onFilterChange = useCallback(
      (patch: Partial<ProfileFilterState>, opts?: { replace?: boolean }) => {
        changes.push([patch, opts])
        setFilters((current) => applyFilterPatch(current, patch))
      },
      [],
    )
    return (
      <ProfileFilters
        models={[]}
        tags={[]}
        filters={filters}
        onFilterChange={onFilterChange}
      />
    )
  }

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(<Harness />)
  })
  return { container, changes }
}

function searchBox(container: HTMLElement): HTMLInputElement {
  return container.querySelector<HTMLInputElement>('.pf-search input')!
}

/** React tracks the input's value internally; bypass its setter to type. */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ProfileFilters — the search box does not spam history (G-07)', () => {
  it('keeps the input responsive while the URL write waits', () => {
    const onFilterChange = vi.fn()
    const container = render({}, onFilterChange)
    const input = searchBox(container)

    type(input, 'n')
    type(input, 'ne')
    type(input, 'neo')

    // Three keystrokes, zero navigations so far.
    expect(input.value).toBe('neo')
    expect(onFilterChange).not.toHaveBeenCalled()
  })

  it('writes once, after the typing settles', () => {
    const onFilterChange = vi.fn()
    const container = render({}, onFilterChange)
    const input = searchBox(container)

    type(input, 'n')
    advance(SEARCH_DEBOUNCE_MS - 1)
    type(input, 'ne')
    advance(SEARCH_DEBOUNCE_MS - 1)
    type(input, 'neo')
    expect(onFilterChange).not.toHaveBeenCalled()

    advance(SEARCH_DEBOUNCE_MS)
    expect(onFilterChange).toHaveBeenCalledTimes(1)
    expect(onFilterChange).toHaveBeenCalledWith(
      { search: 'neo' },
      { replace: true },
    )
  })

  it('uses replace so Back is not one step per keystroke', () => {
    const { container, changes } = renderControlled()
    type(searchBox(container), 'review')
    advance(SEARCH_DEBOUNCE_MS)
    expect(changes).toEqual([[{ search: 'review' }, { replace: true }]])
  })

  it('does not echo its own write back as a second navigation', () => {
    const { container, changes } = renderControlled()
    type(searchBox(container), 'review')
    advance(SEARCH_DEBOUNCE_MS * 4)
    expect(changes).toHaveLength(1)
    expect(searchBox(container).value).toBe('review')
  })

  it('does not write anything back when the URL already agrees', () => {
    const onFilterChange = vi.fn()
    render({ search: 'review' }, onFilterChange)
    advance(SEARCH_DEBOUNCE_MS * 4)
    expect(onFilterChange).not.toHaveBeenCalled()
  })

  it('adopts a deep-linked query', () => {
    const container = render({ search: 'review' })
    expect(searchBox(container).value).toBe('review')
  })

  it('adopts a search that changed underneath it (back button)', () => {
    const container = render({ search: 'review' })
    const input = searchBox(container)
    type(input, 'reviewer')

    // Back lands on the previous query before the debounce elapses.
    act(() => {
      roots[roots.length - 1].render(
        <ProfileFilters
          models={[]}
          tags={[]}
          filters={{ ...DEFAULT_FILTERS, search: 'ops' }}
          onFilterChange={() => {}}
        />,
      )
    })
    expect(input.value).toBe('ops')
  })
})

describe('ProfileFilters — pills and clearing', () => {
  it('reports a pill click immediately, with no replace', () => {
    const { container, changes } = renderControlled()
    const t2 = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.filter-pill'),
    ).find((b) => b.textContent === 'T2')!
    act(() => {
      t2.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    // A pill press is a deliberate step the Back button should be able to undo.
    expect(changes).toEqual([[{ tierFilter: '2' }, undefined]])
  })

  it('offers Clear filters only when something is filtered', () => {
    expect(render().querySelector('.pf-clear-filters')).toBeNull()
    expect(
      render({ tierFilter: '2' }).querySelector('.pf-clear-filters'),
    ).not.toBeNull()
  })

  it('does not offer Clear filters for a page change alone', () => {
    expect(render({ page: 3 }).querySelector('.pf-clear-filters')).toBeNull()
  })

  it('clearing resets every filter at once and empties the box', () => {
    const { container, changes } = renderControlled({
      tierFilter: '2',
      search: 'neo',
    })
    const clear = container.querySelector<HTMLButtonElement>('.pf-clear-filters')!
    act(() => {
      clear.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(changes).toEqual([[{ ...DEFAULT_FILTERS }, undefined]])
    expect(searchBox(container).value).toBe('')

    // And the cleared box must not immediately re-write the old query.
    advance(SEARCH_DEBOUNCE_MS * 2)
    expect(changes).toHaveLength(1)
  })
})
