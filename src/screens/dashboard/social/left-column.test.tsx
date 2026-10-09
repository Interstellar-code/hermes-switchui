// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LeftColumn } from './left-column'
import { mockDashboardSocial, mockDashboardSocialEmpty } from './mock'
import type { DashboardSocial } from '@/types/dashboard-social'

afterEach(cleanup)

type LeftColumnData = Pick<
  DashboardSocial,
  'operator' | 'agents' | 'hotTopics' | 'badges'
>

const data = (overrides: Partial<LeftColumnData> = {}): LeftColumnData => ({
  operator: mockDashboardSocial.operator,
  agents: mockDashboardSocial.agents,
  hotTopics: mockDashboardSocial.hotTopics,
  badges: mockDashboardSocial.badges,
  ...overrides,
})

const noop = () => {}

describe('LeftColumn — mock data', () => {
  it('shows the operator level, name, XP text and bar value', () => {
    render(<LeftColumn data={data()} onOpenAgent={noop} onOpenBadges={noop} />)
    expect(screen.getByText('LEVEL 3')).toBeTruthy()
    expect(screen.getByText('Rohit')).toBeTruthy()
    expect(screen.getByText('Operator · 5 agent profiles')).toBeTruthy()
    expect(screen.getByText('4,120 XP')).toBeTruthy()
    expect(screen.getByText('1,880 to L4')).toBeTruthy()
    const bar = screen.getByRole('progressbar', {
      name: 'Experience toward level 4',
    })
    expect(bar.getAttribute('aria-valuenow')).toBe('37')
  })

  it('badge tile counts earned badges and opens the badges view', () => {
    const onOpenBadges = vi.fn()
    render(
      <LeftColumn
        data={data()}
        onOpenAgent={noop}
        onOpenBadges={onOpenBadges}
      />,
    )
    const earned = (mockDashboardSocial.badges ?? []).filter(
      (b) => b.earnedAt !== null,
    )
    expect(earned).toHaveLength(8)
    fireEvent.click(
      screen.getByRole('button', { name: 'View badges, 8 earned' }),
    )
    expect(onOpenBadges).toHaveBeenCalledTimes(1)
  })

  it('agent rows open the agent and only working agents show the dot', () => {
    const onOpenAgent = vi.fn()
    render(
      <LeftColumn
        data={data()}
        onOpenAgent={onOpenAgent}
        onOpenBadges={noop}
      />,
    )
    fireEvent.click(
      screen.getByRole('button', {
        name: 'hermes-switch, 993 sessions, working now',
      }),
    )
    expect(onOpenAgent).toHaveBeenCalledWith('hermes-switch')
    fireEvent.click(
      screen.getByRole('button', { name: 'trinity, 4 sessions, idle' }),
    )
    expect(onOpenAgent).toHaveBeenCalledWith('trinity')
    // exactly the two working avatars (hermes-switch, neo) carry the dot
    expect(screen.getAllByText('working now')).toHaveLength(2)
    expect(
      screen.getByRole('button', { name: 'morpheus, 120 sessions, idle' }),
    ).toBeTruthy()
  })

  it('renders five hot topic links with their hrefs', () => {
    render(<LeftColumn data={data()} onOpenAgent={noop} onOpenBadges={noop} />)
    const topics = mockDashboardSocial.hotTopics ?? []
    expect(topics).toHaveLength(5)
    topics.forEach((topic, i) => {
      const link = screen.getByRole('link', {
        name: `#${i + 1} ${topic.label}`,
      })
      expect(link.getAttribute('href')).toBe(topic.href)
    })
  })
})

describe('LeftColumn — empty and partial data', () => {
  it('renders three Unavailable states without crashing or inventing numbers', () => {
    render(
      <LeftColumn
        data={mockDashboardSocialEmpty}
        onOpenAgent={noop}
        onOpenBadges={noop}
      />,
    )
    expect(screen.getAllByText('Unavailable')).toHaveLength(3)
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByText('No agent profiles yet')).toBeNull()
  })

  it('empty agents list says so', () => {
    render(
      <LeftColumn
        data={data({ agents: [] })}
        onOpenAgent={noop}
        onOpenBadges={noop}
      />,
    )
    expect(screen.getByText('No agent profiles yet')).toBeTruthy()
    expect(screen.getByText('Operator · 0 agent profiles')).toBeTruthy()
  })

  it('null badges keeps the tile but invents no count', () => {
    render(
      <LeftColumn
        data={data({ badges: null })}
        onOpenAgent={noop}
        onOpenBadges={noop}
      />,
    )
    expect(screen.getByRole('button', { name: 'View badges' })).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: 'View badges, 8 earned' }),
    ).toBeNull()
  })
})
