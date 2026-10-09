// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { mockDashboardSocial, mockDashboardSocialEmpty } from './mock'
import {
  AgentAvatar,
  Chip,
  CountRing,
  LevelRing,
  Panel,
  ProgressBar,
  SectionHeading,
  agentColor,
} from './primitives'
import type { DashboardSocial } from '@/types/dashboard-social'

afterEach(cleanup)

describe('primitives', () => {
  it('LevelRing exposes the level', () => {
    render(<LevelRing initial="R" level={3} progress={0.5} />)
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain(
      'Level 3',
    )
    expect(screen.getByText('LEVEL 3')).toBeTruthy()
  })

  it('ProgressBar sets aria-valuenow and clamps', () => {
    const { rerender } = render(<ProgressBar value={0.4} label="xp" />)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(
      '40',
    )
    rerender(<ProgressBar value={7} label="xp" />)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(
      '100',
    )
    rerender(<ProgressBar value={-2} label="xp" />)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(
      '0',
    )
  })

  it('CountRing renders link, count, hides at 0, shows ok dot', () => {
    const { rerender } = render(
      <CountRing href="/cron" label="Cron" color="red" icon="i" count={8} />,
    )
    expect(screen.getByRole('link').getAttribute('href')).toBe('/cron')
    expect(screen.getByText('8')).toBeTruthy()
    rerender(
      <CountRing href="/cron" label="Cron" color="red" icon="i" count={0} />,
    )
    expect(screen.queryByText('0')).toBeNull()
    rerender(<CountRing href="/g" label="Gateway" color="red" icon="i" ok />)
    expect(screen.getByTestId('count-ring-ok')).toBeTruthy()
  })

  it('AgentAvatar shows sr-only text only when working', () => {
    const { rerender } = render(
      <AgentAvatar initials="HS" color="red" working />,
    )
    expect(screen.getByText('working now').className).toContain('sr-only')
    rerender(<AgentAvatar initials="HS" color="red" />)
    expect(screen.queryByText('working now')).toBeNull()
  })

  it('SectionHeading renders count pill and action slot', () => {
    render(
      <SectionHeading id="h" count={3} action={<button>ALL</button>}>
        BADGES
      </SectionHeading>,
    )
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'ALL' })).toBeTruthy()
    expect(screen.getByRole('heading').id).toBe('h')
  })

  it('Panel renders the requested element', () => {
    const { container } = render(<Panel as="aside">x</Panel>)
    expect(container.querySelector('aside')).not.toBeNull()
  })

  it('Chip renders children; agentColor wraps', () => {
    render(<Chip color="red">TAG</Chip>)
    expect(screen.getByText('TAG')).toBeTruthy()
    expect(agentColor(0)).toBe(agentColor(6))
    expect(agentColor(-1)).toBe(agentColor(5))
  })
})

describe('mock data', () => {
  it('satisfies DashboardSocial', () => {
    const a: DashboardSocial = mockDashboardSocial
    const b: DashboardSocial = mockDashboardSocialEmpty
    expect(a.badges).toHaveLength(12)
    expect(
      Object.entries(b).filter(([k, v]) => k !== 'profile' && v === null),
    ).toHaveLength(7)
  })

  it('badge earnedAt is set exactly when have >= need', () => {
    for (const b of mockDashboardSocial.badges ?? []) {
      expect(b.earnedAt !== null).toBe(b.have >= b.need)
    }
  })

  it('operator xp sits inside its level bounds (C2)', () => {
    const o = mockDashboardSocial.operator!
    expect(o.levelStartXp).toBe(500 * o.level * (o.level - 1))
    expect(o.nextLevelXp).toBe(500 * (o.level + 1) * o.level)
    expect(o.xp).toBeGreaterThanOrEqual(o.levelStartXp)
    expect(o.xp).toBeLessThan(o.nextLevelXp)
  })
})

describe('guard', () => {
  it('primitives.tsx holds no hex colour literal', () => {
    const src = readFileSync(
      'src/screens/dashboard/social/primitives.tsx',
      'utf8',
    )
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})
