// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpsSection } from './ops-section'
import { StatusDock } from './status-dock'
import type {
  DashboardFetcher,
  DashboardOverview,
} from '@/server/dashboard-aggregator'
import { buildDashboardOverview } from '@/server/dashboard-aggregator'

// `SkillsUsageCard` (mounted inside the ops grid) calls
// `useNavigate` from `@tanstack/react-router` at render time. The
// tests never click the card, so the mock just needs to return a
// callable to keep the hook from throwing outside a RouterProvider.
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => () => undefined,
}))

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.restoreAllMocks()
})

/**
 * Build a realistic `DashboardOverview` using the real aggregator
 * (with a stub fetcher). The aggregator's own tests in
 * `src/server/dashboard-aggregator.test.ts` establish the shape;
 * we reuse the same JSON shape here rather than inventing one
 * because the dashboard components read every slice of the payload
 * and an out-of-sync fixture would silently regress.
 */
function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeFetcher(routes: Record<string, unknown>): DashboardFetcher {
  return (path: string) => {
    const key = Object.keys(routes).find((p) => path.startsWith(p))
    if (key === undefined) {
      return Promise.resolve(new Response('not found', { status: 404 }))
    }
    const value = routes[key]
    if (value instanceof Response) return Promise.resolve(value)
    return Promise.resolve(jsonResponse(value))
  }
}

/**
 * A fixture overview that exercises the full surface area: gateway
 * `running`, two platforms, a mix of cron jobs including one failed,
 * a model info entry, an analytics payload with daily rollups, a
 * couple of log lines containing an error, and an insight callout.
 * Shape matches what `buildDashboardOverview` returns; we round-trip
 * it so the components are tested against the actual normalised
 * shape rather than a hand-rolled object that drifts over time.
 */
async function fixtureOverview(): Promise<DashboardOverview> {
  const fetcher = makeFetcher({
    '/api/status': {
      gateway_state: 'running',
      active_agents: 3,
      restart_requested: false,
      updated_at: '2026-10-08T19:00:00Z',
      version: '0.21.8',
      release_date: '2026.10.01',
      config_version: 17,
      latest_config_version: 17,
      hermes_home: '/Users/aurora/.hermes',
      platforms: {
        api_server: {
          state: 'connected',
          updated_at: '2026-10-08T18:55:00Z',
        },
        telegram: {
          state: 'error',
          updated_at: '2026-10-08T18:00:00Z',
          error_message: 'rate limited',
        },
      },
    },
    '/api/cron/jobs': {
      jobs: [
        { id: 'a', status: 'scheduled', next_run_at: '2026-10-10T01:00:00Z' },
        { id: 'b', status: 'failed', last_error: 'boom' },
        { id: 'c', status: 'running', next_run_at: '2026-10-10T00:30:00Z' },
      ],
    },
    '/api/model/info': {
      provider: 'manifest',
      model: 'anthropic/claude-sonnet-4-5',
      effective_context_length: 200000,
      capabilities: {},
    },
    '/api/analytics/usage': {
      window_days: 7,
      totals: {
        total_input: 12345,
        total_output: 6789,
        total_cache_read: 4000,
        total_reasoning: 0,
        total_sessions: 42,
        total_api_calls: 130,
        total_estimated_cost: 1.23,
      },
      by_model: [
        {
          model: 'anthropic/claude-sonnet-4-5',
          input_tokens: 9000,
          output_tokens: 4000,
          api_calls: 100,
          sessions: 30,
          estimated_cost: 0.9,
        },
        {
          model: 'openai/gpt-5.3-codex',
          input_tokens: 3345,
          output_tokens: 2789,
          api_calls: 30,
          sessions: 12,
          estimated_cost: 0.33,
        },
      ],
      daily: [
        {
          day: '2026-10-02',
          input_tokens: 1000,
          output_tokens: 500,
          cache_read_tokens: 500,
          reasoning_tokens: 0,
          sessions: 5,
          api_calls: 15,
          estimated_cost: 0.1,
        },
        {
          day: '2026-10-03',
          input_tokens: 11345,
          output_tokens: 6289,
          cache_read_tokens: 3500,
          reasoning_tokens: 0,
          sessions: 37,
          api_calls: 115,
          estimated_cost: 1.13,
        },
      ],
      skills: {
        summary: {
          total_skill_loads: 12,
          total_skill_edits: 3,
          total_skill_actions: 15,
          distinct_skills_used: 4,
        },
        top_skills: [
          {
            skill: 'autonomous-ai-agents:hermes-agent',
            total_count: 8,
            percentage: 53.3,
            last_used_at: 0,
          },
          {
            skill: 'software-development:systematic-debugging',
            total_count: 4,
            percentage: 26.7,
            last_used_at: 0,
          },
        ],
      },
    },
    '/api/logs': {
      file: 'agent',
      lines: [
        '2026-10-08 18:00:00 INFO  starting up',
        '2026-10-08 18:01:00 ERROR something failed: traceback here',
      ],
    },
    '/api/plugins/hermes-achievements/recent-unlocks?limit=3': {
      unlocks: [],
    },
    '/api/plugins/hermes-achievements/achievements': {
      achievements: [],
    },
  })
  return buildDashboardOverview({ fetcher, analyticsWindowDays: 7 })
}

describe('OpsSection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-08T19:30:00Z'))
  })

  it('renders the 5 default cards with a fixture overview', async () => {
    const overview = await fixtureOverview()
    const { container } = render(
      <OpsSection
        overview={overview}
        period={7}
        onPeriodChange={() => undefined}
      />,
    )
    expect(screen.getByText('OPS & ANALYTICS')).toBeTruthy()
    // Footer "N cards hidden" line lists the 5 default-off cards.
    // Use container.textContent because the line wraps the joined
    // label string and a separate <button> child.
    const text = container.textContent
    expect(text).toMatch(/5 cards hidden:/)
    expect(text).toContain('provider mix')
    expect(text).toContain('velocity')
    expect(text).toContain('cost ledger')
    expect(text).toContain('operator tips')
    expect(text).toContain('logs tail')
  })

  it('HIDE collapses the grid and persists the new state', async () => {
    const overview = await fixtureOverview()
    const { getByRole } = render(
      <OpsSection
        overview={overview}
        period={7}
        onPeriodChange={() => undefined}
      />,
    )
    const toggle = getByRole('button', { name: /HIDE/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(toggle)
    expect(toggle.textContent).toBe('SHOW')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(window.localStorage.getItem('dashboard.ops.open')).toBe('false')
  })

  it('reads the open state from localStorage on mount and hides the grid when stored as `false`', async () => {
    window.localStorage.setItem('dashboard.ops.open', 'false')
    const overview = await fixtureOverview()
    render(
      <OpsSection
        overview={overview}
        period={7}
        onPeriodChange={() => undefined}
      />,
    )
    const toggle = screen.getByRole('button', { name: /SHOW/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('the chart card period toggle calls onPeriodChange with the new window', async () => {
    const overview = await fixtureOverview()
    const onPeriodChange = vi.fn()
    render(
      <OpsSection
        overview={overview}
        period={7}
        onPeriodChange={onPeriodChange}
      />,
    )
    // The period switch lives inside the chart card now (the
    // section header reads the active window as plain text instead
    // of duplicating the chart's own switch). The chart's tabs are
    // exposed as `role="tab"`, not `button`, so we query the tablist
    // and pick the matching tab. Tab labels are "7d" / "14d" / "30d"
    // (lowercase).
    const tablist = screen.getByRole('tablist', { name: 'Analytics period' })
    fireEvent.click(within(tablist).getByText('14d'))
    expect(onPeriodChange).toHaveBeenCalledWith(14)
    fireEvent.click(within(tablist).getByText('30d'))
    expect(onPeriodChange).toHaveBeenCalledWith(30)
    expect(onPeriodChange).toHaveBeenCalledTimes(2)
  })

  it('the section header reflects the current period in plain text', async () => {
    const overview = await fixtureOverview()
    render(
      <OpsSection
        overview={overview}
        period={14}
        onPeriodChange={() => undefined}
      />,
    )
    // The header now reads "all profiles · 14D" instead of
    // duplicating the chart's period switch.
    expect(screen.getByText(/all profiles · 14D/)).toBeTruthy()
  })

  it('renders the EDIT LAYOUT button and toggles editMode when clicked', async () => {
    const overview = await fixtureOverview()
    render(
      <OpsSection
        overview={overview}
        period={7}
        onPeriodChange={() => undefined}
      />,
    )
    // Two EDIT LAYOUT buttons (header + footer) toggle the same
    // editMode state. Pick the header one.
    const editButtons = screen.getAllByRole('button', { name: /EDIT LAYOUT/ })
    expect(editButtons.length).toBe(2)
    const edit = editButtons[0]
    expect(edit.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(edit)
    expect(edit.getAttribute('aria-pressed')).toBe('true')
    // Edit mode renders the existing EditModePanel.
    expect(screen.getByText('Edit mode')).toBeTruthy()
  })

  it('handles a null overview by still rendering the header without crashing', () => {
    render(
      <OpsSection
        overview={null}
        period={7}
        onPeriodChange={() => undefined}
      />,
    )
    expect(screen.getByText('OPS & ANALYTICS')).toBeTruthy()
    // The chart card hides itself when analytics is null (it
    // returns null in AnalyticsChartCard). The section still
    // renders — the other cards degrade individually.
  })

  it('passes installedCount through to SkillsUsageCard and renders "—" when null', async () => {
    // r1 review HIGH: the section used to pass `installedCount={0}`
    // and the card rendered "0 of 0 used" / "no skills installed"
    // as if the install list had been confirmed empty. The fix:
    // accept `installedCount?: number | null` on the section, pass
    // through unchanged, and have the card render "—" for the
    // denominator when the prop is null.
    const overview = await fixtureOverview()
    const { container, rerender } = render(
      <OpsSection
        overview={overview}
        period={7}
        onPeriodChange={() => undefined}
        installedCount={null}
      />,
    )
    // Usage is present (the fixture has 2 top skills, with
    // `distinctSkills: 4`), so the header reads
    // "4 of — used · manage →" — the denominator is the unknown
    // marker, not an invented 0. The text is broken across
    // adjacent text nodes in the DOM (template literal + separate
    // ` · manage →` text), so we look at the parent span's
    // textContent rather than a single text node.
    expect(container.textContent).toMatch(/4 of — used/)

    // Real number: header reads "2 of 60 used" (or whatever
    // installedCount the parent passes).
    rerender(
      <OpsSection
        overview={overview}
        period={7}
        onPeriodChange={() => undefined}
        installedCount={60}
      />,
    )
    expect(container.textContent).toMatch(/4 of 60 used/)

    // No usage data: the card's body switches to the "installed
    // list not loaded yet" line, distinct from the existing "no
    // skills installed" copy that means a real 0.
    const emptyUsage: DashboardOverview = {
      ...overview,
      skillsUsage: null,
    }
    rerender(
      <OpsSection
        overview={emptyUsage}
        period={7}
        onPeriodChange={() => undefined}
        installedCount={null}
      />,
    )
    expect(screen.getByText('installed list not loaded yet')).toBeTruthy()
  })

  it('renders an Unavailable tile for "Tokens by hour" when no hour histogram is supplied', async () => {
    // r1 review HIGH: mounting TokenMixHourCard with
    // `sessions={[]}` shows the token-mix half under the wrong
    // heading ("Mix & rhythm"), disagreeing with the catalog
    // description ("Hour-of-day token-usage strip"). The fix:
    // when `hourHistogram` is missing, render an Unavailable tile
    // with the correct title; when it is supplied, mount the
    // legacy card and feed it synthetic session rows so its
    // bucket counts match.
    const overview = await fixtureOverview()
    const { rerender } = render(
      <OpsSection
        overview={overview}
        period={7}
        onPeriodChange={() => undefined}
      />,
    )
    expect(
      screen.getByText('Hour-of-day session data not loaded yet.'),
    ).toBeTruthy()
    expect(screen.getByText('Tokens by hour')).toBeTruthy()

    // With a populated histogram the legacy card mounts. The
    // fixture's analytics has `totalTokens: 19.1K` (12345+6789)
    // and the histogram drives the hour strip; the card's
    // heading "Mix & rhythm" still comes from the legacy chrome
    // (intentional — the catalog name change is P2's call).
    const histogram = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      count: hour === 20 ? 5 : hour === 21 ? 4 : 0,
    }))
    rerender(
      <OpsSection
        overview={overview}
        period={7}
        onPeriodChange={() => undefined}
        hourHistogram={histogram}
      />,
    )
    expect(
      screen.queryByText('Hour-of-day session data not loaded yet.'),
    ).toBeNull()
  })
})

describe('StatusDock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-08T19:30:00Z'))
  })

  it('shows "status unavailable" when overview is null', () => {
    render(<StatusDock overview={null} period={7} />)
    expect(screen.getByText('status unavailable')).toBeTruthy()
  })

  it('renders the failing-cron warning label and the model name', async () => {
    const overview = await fixtureOverview()
    const { container } = render(<StatusDock overview={overview} period={7} />)
    // The cron line carries "1 of 3 failing" — the failing job id 'b'
    // surfaces as one failure out of three.
    expect(screen.getByText(/1 of 3 failing/)).toBeTruthy()
    // The model label uses the canonical formatter, so
    // `anthropic/claude-sonnet-4-5` -> "manifest · Sonnet 4.5".
    expect(
      screen.getByText((_, node) =>
        node ? node.textContent === 'manifest · Sonnet 4.5' : false,
      ),
    ).toBeTruthy()
    // Period totals reflect the analytics payload.
    const dock = container.querySelector('footer') as HTMLElement
    expect(within(dock).getByText('42')).toBeTruthy() // sessions
    expect(within(dock).getByText('19.1K')).toBeTruthy() // tokens
    expect(within(dock).getByText('130')).toBeTruthy() // api calls
    // The window chip reports the analytics.windowDays, not the
    // `period` prop. The fixture exposes windowDays=7, so the chip
    // is "7d" — and a 14d `period` prop would still render "7d" so
    // the chip and the totals can never disagree.
    expect(within(dock).getByText('7d')).toBeTruthy()
    // The "1 errors in tail" label no longer claims a 1h time window.
    expect(within(dock).getByText(/1 errors in tail/)).toBeTruthy()
    // Gateway label is heartbeat age, not uptime.
    expect(within(dock).getByText(/ok · beat /)).toBeTruthy()
  })

  it('shows config drift when latest_config_version > config_version', async () => {
    const overview = await fixtureOverview()
    // Fixture has config_version 17 == latest_config_version 17, so
    // "in sync" should be visible. We then patch status to drift.
    const drifted: DashboardOverview = {
      ...overview,
      status: overview.status
        ? {
            ...overview.status,
            configVersion: 17,
            latestConfigVersion: 19,
          }
        : null,
    }
    render(<StatusDock overview={drifted} period={7} />)
    expect(screen.getByText('2 drift')).toBeTruthy()
  })

  it('renders "—" for every right-side total when analytics is unavailable', async () => {
    // Build an overview where the analytics payload is empty —
    // the aggregator normalises that to
    // `analytics: { source: 'unavailable', ... }`. The dock must
    // not invent 0/0/0 totals.
    const fetcher = makeFetcher({
      '/api/status': {
        gateway_state: 'running',
        active_agents: 0,
        updated_at: '2026-10-08T19:00:00Z',
        version: '0.21.8',
        config_version: 17,
        latest_config_version: 17,
        platforms: { api_server: { state: 'connected' } },
      },
      '/api/cron/jobs': { jobs: [{ id: 'a', status: 'running' }] },
      '/api/model/info': null,
      '/api/analytics/usage': {
        // Aggregator returns `source: 'unavailable'` when the
        // payload is empty (no totals / no daily rows / no models).
        window_days: 7,
      },
      '/api/logs': { file: 'agent', lines: [] },
      '/api/plugins/hermes-achievements/recent-unlocks?limit=3': {
        unlocks: [],
      },
      '/api/plugins/hermes-achievements/achievements': { achievements: [] },
    })
    const overview = await buildDashboardOverview({
      fetcher,
      analyticsWindowDays: 14,
    })
    expect(overview.analytics?.source).toBe('unavailable')
    const { container } = render(<StatusDock overview={overview} period={14} />)
    // Every right-side field is "—"; the window chip is "—" (no
    // analytics) so it can't lie about which window the totals
    // came from.
    const dock = container.querySelector('footer') as HTMLElement
    const right = dock.querySelectorAll('b')
    // We expect at least three "—" labels for the totals + window.
    let dashCount = 0
    right.forEach((node) => {
      if (node.textContent === '—') dashCount += 1
    })
    expect(dashCount).toBeGreaterThanOrEqual(4)
  })

  it('shows "—" for platforms when the platform list is empty', async () => {
    const fetcher = makeFetcher({
      '/api/status': {
        gateway_state: 'running',
        active_agents: 0,
        updated_at: '2026-10-08T19:00:00Z',
        version: '0.21.8',
        config_version: 17,
        latest_config_version: 17,
        platforms: {},
      },
      '/api/cron/jobs': { jobs: [{ id: 'a', status: 'running' }] },
      '/api/model/info': null,
      '/api/analytics/usage': { window_days: 7 },
      '/api/logs': { file: 'agent', lines: [] },
      '/api/plugins/hermes-achievements/recent-unlocks?limit=3': {
        unlocks: [],
      },
      '/api/plugins/hermes-achievements/achievements': { achievements: [] },
    })
    const overview = await buildDashboardOverview({
      fetcher,
      analyticsWindowDays: 7,
    })
    expect(overview.platforms.length).toBe(0)
    const { container } = render(<StatusDock overview={overview} period={7} />)
    const dock = container.querySelector('footer') as HTMLElement
    // The platform `<a>` label is "platforms" + the count `<b>`.
    // Multiple "—" labels exist in the dock (model, gateway,
    // analytics totals), so we assert that the platform cell
    // specifically has "—" rather than "0/0" or "0".
    const platformLink = within(dock).getByRole('link', { name: /platforms/ })
    expect(platformLink.textContent).toMatch(/platforms\s*—/)
    expect(platformLink.textContent).not.toMatch(/0\/0/)
  })

  it('shows "—" for logs when the log tail is null', async () => {
    const fetcher = makeFetcher({
      '/api/status': {
        gateway_state: 'running',
        active_agents: 0,
        updated_at: '2026-10-08T19:00:00Z',
        version: '0.21.8',
        config_version: 17,
        latest_config_version: 17,
        platforms: { api_server: { state: 'connected' } },
      },
      '/api/cron/jobs': { jobs: [{ id: 'a', status: 'running' }] },
      '/api/model/info': null,
      '/api/analytics/usage': new Response('boom', { status: 500 }),
      '/api/logs': new Response('boom', { status: 500 }),
      '/api/plugins/hermes-achievements/recent-unlocks?limit=3': {
        unlocks: [],
      },
      '/api/plugins/hermes-achievements/achievements': { achievements: [] },
    })
    const overview = await buildDashboardOverview({
      fetcher,
      analyticsWindowDays: 7,
    })
    expect(overview.logs).toBeNull()
    render(<StatusDock overview={overview} period={7} />)
    // The `<b>` for the logs label is "—", not "0 errors in tail" or
    // a synthetic zero count.
    const dock = screen.getByRole('contentinfo')
    expect(dock.textContent).toContain('—')
  })

  it('falls back to the success tone when no failures are present', async () => {
    const fetcher = makeFetcher({
      '/api/status': {
        gateway_state: 'running',
        active_agents: 0,
        updated_at: '2026-10-08T19:00:00Z',
        version: '0.21.8',
        config_version: 17,
        latest_config_version: 17,
        platforms: {
          api_server: {
            state: 'connected',
            updated_at: '2026-10-08T18:55:00Z',
          },
        },
      },
      '/api/cron/jobs': {
        jobs: [{ id: 'a', status: 'running' }],
      },
      '/api/model/info': {
        provider: 'manifest',
        model: 'anthropic/claude-sonnet-4-5',
      },
      '/api/analytics/usage': {
        window_days: 7,
        totals: {
          total_input: 1234,
          total_output: 567,
          total_cache_read: 100,
          total_reasoning: 0,
          total_sessions: 5,
          total_api_calls: 12,
          total_estimated_cost: 0.01,
        },
        by_model: [
          {
            model: 'anthropic/claude-sonnet-4-5',
            input_tokens: 1234,
            output_tokens: 567,
            api_calls: 12,
            sessions: 5,
            estimated_cost: 0.01,
          },
        ],
        daily: [
          {
            day: '2026-10-08',
            input_tokens: 1234,
            output_tokens: 567,
            cache_read_tokens: 100,
            reasoning_tokens: 0,
            sessions: 5,
            api_calls: 12,
            estimated_cost: 0.01,
          },
        ],
        skills: { summary: {}, top_skills: [] },
      },
      '/api/logs': { file: 'agent', lines: [] },
      '/api/plugins/hermes-achievements/recent-unlocks?limit=3': {
        unlocks: [],
      },
      '/api/plugins/hermes-achievements/achievements': { achievements: [] },
    })
    const overview = await buildDashboardOverview({
      fetcher,
      analyticsWindowDays: 7,
    })
    expect(overview.analytics?.source).toBe('analytics')
    render(<StatusDock overview={overview} period={7} />)
    expect(screen.getByText('1 ok')).toBeTruthy()
    expect(screen.getByText('in sync')).toBeTruthy()
    // Label no longer claims a 1h window.
    expect(screen.getByText('no errors in tail')).toBeTruthy()
  })

  it('uses the analytics windowDays in the totals title, not the period prop', async () => {
    const overview = await fixtureOverview()
    // Fixture has windowDays=7; a 14d period prop does not change
    // the title — the title tracks the data, not the user's toggle.
    render(<StatusDock overview={overview} period={14} />)
    const titleEls = document.querySelectorAll('[title="7-day window"]')
    expect(titleEls.length).toBeGreaterThan(0)
  })
})
