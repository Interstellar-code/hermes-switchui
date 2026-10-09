// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SkillsUsageCard } from './skills-usage-card'
import type { DashboardSkillsUsageSection } from '@/server/dashboard-aggregator'

// The card calls `useNavigate()` from `@tanstack/react-router` at
// render time and the click handler is the only thing that invokes
// it. We never trigger the click in these tests, so the mock just
// needs to return a callable so the hook call doesn't throw.
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => () => undefined,
}))

afterEach(cleanup)

/**
 * Render the card with a controlled `installedCount` and optional
 * `usage` slice. The card lives inside a `<button>` that navigates
 * to `/skills` on click; we never click it, so the mocked
 * `useNavigate` is a no-op.
 */
function renderCard(
  installedCount: number | null | undefined,
  usage: DashboardSkillsUsageSection | null = null,
) {
  return render(
    <SkillsUsageCard
      usage={usage}
      installedCount={installedCount}
      onOpen={() => undefined}
    />,
  )
}

const USAGE: DashboardSkillsUsageSection = {
  totalLoads: 8,
  totalEdits: 2,
  totalActions: 10,
  distinctSkills: 2,
  topSkills: [
    {
      skill: 'autonomous-ai-agents:hermes-agent',
      totalCount: 6,
      percentage: 60,
      lastUsedAt: 0,
    },
    {
      skill: 'software-development:systematic-debugging',
      totalCount: 4,
      percentage: 40,
      lastUsedAt: 0,
    },
  ],
}

describe('SkillsUsageCard', () => {
  it('renders "—" for the denominator when installedCount is null and usage is present', () => {
    renderCard(null, USAGE)
    // The header reads "N of — used" — the unknown marker in
    // place of an invented 0.
    expect(screen.getByText(/2 of — used/)).toBeTruthy()
  })

  it('renders the real denominator when installedCount is a number', () => {
    renderCard(154, USAGE)
    expect(screen.getByText(/2 of 154 used/)).toBeTruthy()
  })

  it('renders "—" for the install count when installedCount is undefined', () => {
    renderCard(undefined, USAGE)
    expect(screen.getByText(/2 of — used/)).toBeTruthy()
  })

  it('renders "no skills installed" when installedCount is a real 0 and usage is empty', () => {
    renderCard(0, null)
    expect(screen.getByText('no skills installed')).toBeTruthy()
  })

  it('renders "installed list not loaded yet" when installedCount is null and usage is empty', () => {
    renderCard(null, null)
    expect(screen.getByText('installed list not loaded yet')).toBeTruthy()
  })
})
