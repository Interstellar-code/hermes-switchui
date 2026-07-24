// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SidebarSourceChipsV2 } from './sidebar-source-chips-v2'

const filterStore = {
  sources: [] as Array<string>,
  toggleSource: vi.fn(),
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

  it('uses the calm selection color without an attention glow', () => {
    filterStore.sources = ['chat']
    render(<SidebarSourceChipsV2 sourceCounts={{ chat: 1 }} />)

    const chip = screen.getByTestId('chip-chat')
    expect(chip.getAttribute('data-attention')).toBeNull()
    expect(chip.getAttribute('style')).toContain('var(--m-info, #5fcfff)')
    expect(chip.getAttribute('style')).toContain('box-shadow: none')
  })

})
