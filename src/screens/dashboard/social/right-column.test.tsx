// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockDashboardSocial, mockDashboardSocialEmpty } from './mock'
import { BadgeDialog } from './badge-dialog'
import { RightColumn, agentRank } from './right-column'
import type {
  DashboardAgent,
  DashboardBadge,
  DashboardSocial,
  OperatorStats,
} from '@/types/dashboard-social'

afterEach(cleanup)

const LOCKED_BADGE: DashboardBadge = {
  id: 'fresh-start',
  name: 'Fresh start',
  how: '5 workflow runs',
  have: 1,
  need: 10,
  earnedAt: null,
}

const slice = (data: DashboardSocial) => ({
  agents: data.agents,
  operator: data.operator,
  badges: data.badges,
})

const renderColumn = (
  data: Parameters<typeof RightColumn>[0]['data'],
  overrides: Partial<{
    onOpenAgent: (id: string) => void
    onOpenBadges: () => void
  }> = {},
) => {
  const onOpenAgent = overrides.onOpenAgent ?? vi.fn()
  const onOpenBadges = overrides.onOpenBadges ?? vi.fn()
  const view = render(
    <RightColumn
      data={data}
      onOpenAgent={onOpenAgent}
      onOpenBadges={onOpenBadges}
    />,
  )
  return { onOpenAgent, onOpenBadges, container: view.container }
}

function agent(overrides: Partial<DashboardAgent>): DashboardAgent {
  return {
    id: 'agent',
    initials: 'AG',
    sessions: 1,
    tokensWeek: 1,
    tasksWeek: 0,
    runsWeek: 0,
    working: false,
    topTools: [],
    ...overrides,
  }
}

describe('RightColumn leaderboard', () => {
  it('re-orders the podium for every metric', () => {
    renderColumn(slice(mockDashboardSocial))
    const rankOneFor: Record<string, RegExp> = {
      TOKENS: /hermes-switch, rank 1/,
      SESSIONS: /hermes-switch, rank 1/,
      TASKS: /neo, rank 1/,
      RUNS: /morpheus, rank 1/,
    }
    for (const [label, name] of Object.entries(rankOneFor)) {
      fireEvent.click(screen.getByRole('button', { name: label }))
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
  })

  it('marks the picked metric as pressed and swaps the caption', () => {
    renderColumn(slice(mockDashboardSocial))
    const tokens = screen.getByRole('button', { name: 'TOKENS' })
    expect(tokens.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Tokens this week · resets Monday')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'RUNS' }))
    expect(tokens.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText('Workflow runs this week')).toBeTruthy()
  })

  it('keeps id order when agents tie on the active metric', () => {
    renderColumn({
      agents: [
        agent({ id: 'zeta', sessions: 5 }),
        agent({ id: 'alpha', sessions: 5 }),
        agent({ id: 'mid', sessions: 5, tokensWeek: 5000 }),
      ],
      operator: null,
      badges: null,
    })
    fireEvent.click(screen.getByRole('button', { name: 'SESSIONS' }))
    // All three tie on sessions, so rank follows id: alpha, mid, zeta.
    expect(screen.getByRole('button', { name: /alpha, rank 1/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /mid, rank 2/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /zeta, rank 3/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /rank 4/ })).toBeNull()
  })

  it('shows only the ranks present when fewer than three agents', () => {
    renderColumn({
      agents: [agent({ id: 'solo', tokensWeek: 30 })],
      operator: null,
      badges: null,
    })
    expect(screen.getByRole('button', { name: /solo, rank 1/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /rank 2/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /rank 3/ })).toBeNull()
  })

  it('podium blocks and rows call onOpenAgent and open the agent dialog', () => {
    const { onOpenAgent } = renderColumn(slice(mockDashboardSocial), {
      onOpenAgent: vi.fn(),
    })
    fireEvent.click(
      screen.getByRole('button', { name: /hermes-switch, rank 1/ }),
    )
    expect(onOpenAgent).toHaveBeenCalledWith('hermes-switch')

    const dialog = screen.getByRole('dialog')
    expect(
      within(dialog).getByRole('heading', { name: 'hermes-switch' }),
    ).toBeTruthy()
    expect(within(dialog).getByText('agent profile · working now')).toBeTruthy()
    expect(within(dialog).getByText('4.2M')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /trinity, rank 4/ }))
    expect(onOpenAgent).toHaveBeenCalledWith('trinity')
    expect(
      within(screen.getByRole('dialog')).getByText('agent profile · idle'),
    ).toBeTruthy()
  })
})

describe('RightColumn zero leaderboard', () => {
  const zeroRuns = (agents: Array<DashboardAgent>) => ({
    agents,
    operator: null,
    badges: null,
  })

  it('shows an empty state instead of a #1 when every value is 0', () => {
    renderColumn(
      zeroRuns([
        agent({ id: 'a', runsWeek: 0 }),
        agent({ id: 'b', runsWeek: 0 }),
      ]),
    )
    fireEvent.click(screen.getByRole('button', { name: 'RUNS' }))
    expect(screen.getByText('No runs this week yet')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /rank 1/ })).toBeNull()
  })

  it('keeps the podium when only some values are 0', () => {
    renderColumn(
      zeroRuns([
        agent({ id: 'a', runsWeek: 3 }),
        agent({ id: 'b', runsWeek: 0 }),
      ]),
    )
    fireEvent.click(screen.getByRole('button', { name: 'RUNS' }))
    expect(screen.queryByText(/this week yet/)).toBeNull()
    expect(screen.getByRole('button', { name: /^a, rank 1/ })).toBeTruthy()
  })
})

describe('agent dialog rank', () => {
  it('uses the current leaderboard metric in the right column', () => {
    renderColumn(slice(mockDashboardSocial))
    fireEvent.click(screen.getByRole('button', { name: 'TASKS' }))
    fireEvent.click(screen.getByRole('button', { name: /^neo, rank 1/ }))
    expect(within(screen.getByRole('dialog')).getByText(/RANK 1/)).toBeTruthy()
  })

  it('agentRank defaults to tokens and honours an explicit metric', () => {
    const agents = mockDashboardSocial.agents ?? []
    expect(agentRank(agents, 'neo')).toBe(2)
    expect(agentRank(agents, 'neo', 'tasks')).toBe(1)
    expect(agentRank(agents, 'nobody')).toBe(0)
  })
})

describe('RightColumn streak', () => {
  it('renders the streak, best run and this week from activeDays', () => {
    renderColumn(slice(mockDashboardSocial))
    expect(screen.getByText('12')).toBeTruthy()
    expect(screen.getByText('days in a row')).toBeTruthy()
    expect(
      screen.getByText('best 21 · a chat or run today keeps it'),
    ).toBeTruthy()

    const week = screen.getByLabelText(
      'This week: 6 of 7 days active, today not yet',
    )
    const cells = week.querySelectorAll('[data-state]')
    expect(cells).toHaveLength(7)
    expect(cells[6].getAttribute('data-state')).toBe('today')
    expect(
      Array.from(cells).filter(
        (cell) => cell.getAttribute('data-state') === 'active',
      ),
    ).toHaveLength(6)
    expect(screen.getByText('Sunday not active')).toBeTruthy()
  })

  it('drops the today hint when today is already active', () => {
    renderColumn({
      agents: null,
      operator: {
        ...(mockDashboardSocial.operator as OperatorStats),
        activeDays: [true, true, true, true, true, true, true],
      },
      badges: null,
    })
    expect(screen.getByLabelText('This week: 7 of 7 days active')).toBeTruthy()
    const cells = screen
      .getByLabelText('This week: 7 of 7 days active')
      .querySelectorAll('[data-state="active"]')
    expect(cells).toHaveLength(7)
  })
})

describe('RightColumn badges', () => {
  it('lists the three unearned badges with the most progress', () => {
    renderColumn(slice(mockDashboardSocial))
    // Earned = 8 of the 12 mock badges.
    expect(screen.getByText('8 of 12')).toBeTruthy()
    expect(screen.getByText('Token whale')).toBeTruthy()
    expect(screen.getByText('Night owl')).toBeTruthy()
    expect(screen.getByText('Maestro')).toBeTruthy()
    // Lower-progress unearned badges stay out of the top three.
    expect(screen.queryByText('Streak 30')).toBeNull()
    expect(screen.queryByText('First chat')).toBeNull()
    expect(screen.getByText('4.2M / 5.0M')).toBeTruthy()
    expect(screen.getByLabelText('Token whale progress')).toBeTruthy()
  })

  it('earned only when have >= need, never with a progress bar', () => {
    renderColumn(slice(mockDashboardSocial))
    fireEvent.click(screen.getByRole('button', { name: 'ALL' }))

    const dialog = screen.getByRole('dialog')
    expect(
      within(dialog).getByRole('heading', { name: 'Badges · 8 of 12' }),
    ).toBeTruthy()

    const earned = within(dialog).getByRole('group', { name: 'First chat' })
    expect(within(earned).getByText('earned')).toBeTruthy()
    expect(within(earned).queryByRole('progressbar')).toBeNull()

    const inProgress = within(dialog).getByRole('group', {
      name: 'Token whale',
    })
    expect(within(inProgress).queryByText('earned')).toBeNull()
    expect(within(inProgress).getByRole('progressbar')).toBeTruthy()
    expect(within(inProgress).getByText('4.2M / 5.0M')).toBeTruthy()

    const locked = within(dialog).getByRole('group', { name: 'Streak 30' })
    expect(within(locked).queryByText('earned')).toBeNull()
    expect(within(locked).getByRole('progressbar')).toBeTruthy()
    expect(within(locked).getByText('12 / 30')).toBeTruthy()
  })

  it('marks a badge below 30% as locked with neither earned nor a bar', () => {
    render(<BadgeDialog badges={[LOCKED_BADGE]} open onClose={vi.fn()} />)
    const locked = within(screen.getByRole('dialog')).getByRole('group', {
      name: 'Fresh start',
    })
    expect(within(locked).queryByText('earned')).toBeNull()
    expect(within(locked).queryByRole('progressbar')).toBeNull()
  })
})

describe('dialogs', () => {
  it('closes both dialogs on Escape and returns focus to the opener', () => {
    renderColumn(slice(mockDashboardSocial))

    const podium = screen.getByRole('button', { name: /hermes-switch, rank 1/ })
    podium.focus()
    fireEvent.click(podium)
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(podium)

    const allButton = screen.getByRole('button', { name: 'ALL' })
    allButton.focus()
    fireEvent.click(allButton)
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(allButton)
  })

  it('closes on the close button and links to the real profile and chat routes', () => {
    renderColumn(slice(mockDashboardSocial))
    fireEvent.click(
      screen.getByRole('button', { name: /hermes-switch, rank 1/ }),
    )
    const dialog = screen.getByRole('dialog')
    expect(
      within(dialog)
        .getByRole('link', { name: 'OPEN PROFILE' })
        .getAttribute('href'),
    ).toBe('/profiles')
    expect(
      within(dialog)
        .getByRole('link', { name: /NEW CHAT WITH hermes-switch/ })
        .getAttribute('href'),
    ).toBe('/chat')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('null slices', () => {
  it('renders Unavailable with no numbers when every slice is null', () => {
    const { container } = renderColumn(slice(mockDashboardSocialEmpty))
    expect(screen.getAllByText('Unavailable')).toHaveLength(3)
    expect(container.textContent).not.toMatch(/\d/)
  })

  it('still renders the panels that have data when one slice is null', () => {
    renderColumn({
      agents: null,
      operator: mockDashboardSocial.operator,
      badges: null,
    })
    expect(screen.getByText('days in a row')).toBeTruthy()
    expect(screen.getAllByText('Unavailable')).toHaveLength(2)
  })
})

describe('RightColumn auto-fit', () => {
  const LOCKED = (i: number): DashboardBadge => ({
    ...LOCKED_BADGE,
    id: `b${i}`,
    name: `Badge ${i}`,
    have: i,
  })
  const badgeData = (n: number) => ({
    ...slice(mockDashboardSocial),
    badges: Array.from({ length: n }, (_, i) => LOCKED(i + 1)),
  })

  it('without ResizeObserver lists 3 in-progress badges', () => {
    renderColumn(badgeData(8))
    expect(screen.getAllByLabelText(/ progress$/)).toHaveLength(3)
  })

  it('badgeMaxRows pins the list, capped at 6 in-progress badges', () => {
    const { rerender } = render(
      <RightColumn data={badgeData(8)} badgeMaxRows={5} />,
    )
    expect(screen.getAllByLabelText(/ progress$/)).toHaveLength(5)
    rerender(<RightColumn data={badgeData(8)} badgeMaxRows={20} />)
    expect(screen.getAllByLabelText(/ progress$/)).toHaveLength(6)
    // Highest progress first.
    expect(
      screen.getAllByLabelText(/ progress$/)[0].getAttribute('aria-label'),
    ).toBe('Badge 8 progress')
  })

  it('stretches, grows the BADGES card and wraps its cards at medium widths', () => {
    renderColumn(slice(mockDashboardSocial))
    const aside = screen.getByRole('complementary', {
      name: 'Leaderboard, streak and badges',
    })
    expect(aside.className).toContain('self-stretch')
    expect(aside.className).toContain('min-[761px]:max-[1180px]:flex-row')
    expect(aside.className).toContain('min-[761px]:max-[1180px]:flex-wrap')
    const cards = Array.from(aside.querySelectorAll('section'))
    expect(cards).toHaveLength(3)
    for (const card of cards) {
      expect(card.className).toContain(
        'min-[761px]:max-[1180px]:flex-[1_1_300px]',
      )
    }
    expect(cards[2].className).toContain('flex-1')
    expect(cards[0].className.split(' ')).not.toContain('flex-1')
  })

  it('podium blocks are ~20% shorter (100 / 78 / 62)', () => {
    renderColumn(slice(mockDashboardSocial))
    const height = (rank: number) =>
      (
        screen
          .getByRole('button', { name: new RegExp(`, rank ${rank},`) })
          .querySelector('span.rounded-t-\\[5px\\]') as HTMLElement
      ).style.height
    expect([height(1), height(2), height(3)]).toEqual(['100px', '78px', '62px'])
  })
})
