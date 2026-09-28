// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SidebarSourceChipsV2 } from './sidebar-source-chips-v2'

const filterStore = {
  sources: [] as Array<string>,
  toggleSource: vi.fn(),
  clearSources: vi.fn(),
  reset: vi.fn(),
}

vi.mock('@/stores/sessions-filter-store', () => ({
  useSessionsFilterStore: (
    selector: (state: Record<string, unknown>) => unknown,
  ) => selector(filterStore),
}))

describe('SidebarSourceChipsV2 attention markers', () => {
  afterEach(cleanup)

  beforeEach(() => {
    filterStore.sources = []
    filterStore.toggleSource.mockReset()
    filterStore.clearSources.mockReset()
    filterStore.reset.mockReset()
  })

  it('pulses the active source and steadily glows a completed-update source', () => {
    render(
      <SidebarSourceChipsV2
        sourceCounts={{ chat: 1, cli: 1 }}
        attention={{
          chat: { live: true, updated: false },
          cli: { live: false, updated: true },
        }}
      />,
    )

    expect(
      screen
        .getByTestId('chip-chat')
        .classList.contains('session-attention-pulse'),
    ).toBe(true)
    expect(
      screen
        .getByTestId('chip-cli')
        .classList.contains('session-attention-pulse'),
    ).toBe(false)
    expect(screen.getByTestId('chip-cli').getAttribute('aria-label')).toBe(
      'CLI has unread updates',
    )
  })

  it('draws a selected source chip as hidden, not as the current view', () => {
    filterStore.sources = ['chat']
    render(<SidebarSourceChipsV2 sourceCounts={{ chat: 1 }} />)

    const chip = screen.getByTestId('chip-chat')
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    expect(chip.getAttribute('aria-label')).toBe('CHAT hidden')
    expect(chip.getAttribute('style')).toContain('line-through')
    expect(chip.getAttribute('style')).toContain('box-shadow: none')
  })

  it('a hidden source neither glows nor pulses', () => {
    filterStore.sources = ['chat']
    const { rerender } = render(
      <SidebarSourceChipsV2
        sourceCounts={{ chat: 1 }}
        attention={{ chat: { live: true, updated: false } }}
      />,
    )
    const hiddenChip = screen.getByTestId('chip-chat')
    const hidden = hiddenChip.getAttribute('style')
    expect(hiddenChip.classList.contains('session-attention-pulse')).toBe(false)
    expect(hiddenChip.getAttribute('data-attention')).toBeNull()

    filterStore.sources = []
    rerender(
      <SidebarSourceChipsV2
        sourceCounts={{ chat: 1 }}
        attention={{ chat: { live: true, updated: false } }}
      />,
    )
    const shownChip = screen.getByTestId('chip-chat')
    expect(shownChip.getAttribute('style')).not.toBe(hidden)
    expect(shownChip.classList.contains('session-attention-pulse')).toBe(true)
  })

  it('the ALL chip clears hidden sources without resetting other filters', () => {
    filterStore.sources = ['chat']
    render(<SidebarSourceChipsV2 sourceCounts={{ chat: 1 }} />)

    screen.getByRole('button', { name: 'ALL' }).click()

    expect(filterStore.clearSources).toHaveBeenCalledTimes(1)
    expect(filterStore.reset).not.toHaveBeenCalled()
  })
})
