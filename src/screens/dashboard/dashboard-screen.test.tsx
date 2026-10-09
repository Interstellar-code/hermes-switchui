// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardScreen, useDashboardOverview } from './dashboard-screen'
import { mockDashboardSocial, mockDashboardSocialEmpty } from './social/mock'
import type { DashboardFetcher } from '@/server/dashboard-aggregator'
import { buildDashboardOverview } from '@/server/dashboard-aggregator'

// The screen's header buttons call `useNavigate`; nothing here clicks them.
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => () => undefined,
}))
// Setup checklist has its own fetches/store and is not under test.
vi.mock('./components/setup-checklist-card', () => ({
  SetupChecklistCard: () => null,
}))

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const overviewFetcher: DashboardFetcher = (path) => {
  if (path.startsWith('/api/status')) {
    return Promise.resolve(
      json({
        gateway_state: 'running',
        active_agents: 3,
        version: '0.21.8',
        platforms: {},
      }),
    )
  }
  // Minimal analytics so the Ops chart card (and its period tabs) renders.
  if (path.startsWith('/api/analytics/usage')) {
    return Promise.resolve(
      json({ totals: { total_input: 10, total_output: 5 }, daily: [] }),
    )
  }
  return Promise.resolve(new Response('not found', { status: 404 }))
}

const SESSIONS = {
  sessions: [
    { key: 's1', startedAt: Date.now() - 60_000 },
    { key: 's2', updatedAt: Date.now() - 120_000 },
  ],
}

function stubFetch(
  socialStatus = 200,
  social: () => Promise<Response> = () =>
    Promise.resolve(json(mockDashboardSocial)),
) {
  const overview = buildDashboardOverview({
    fetcher: overviewFetcher,
    analyticsWindowDays: 30,
  })
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/dashboard/social')) {
        return socialStatus === 200
          ? social()
          : new Response('boom', { status: socialStatus })
      }
      if (url.startsWith('/api/dashboard/overview')) {
        return json(await overview)
      }
      if (url.startsWith('/api/gateway-status')) {
        return json({ capabilities: { sessions: true, skills: true } })
      }
      if (url.startsWith('/api/claude-jobs/')) return json({ ok: true })
      if (url.startsWith('/api/sessions')) return json(SESSIONS)
      if (url.startsWith('/api/skills')) return json({ skills: [{}, {}] })
      return new Response('not found', { status: 404 })
    },
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <DashboardScreen />
    </QueryClientProvider>,
  )
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('DashboardScreen', () => {
  it('renders the three social columns, ops section and status dock', async () => {
    const fetchMock = stubFetch()
    renderScreen()

    // left: operator name; right: leaderboard agent; centre: needs-you heading
    await screen.findByText('Rohit')
    expect(screen.getAllByText('hermes-switch').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/NEEDS YOU/).length).toBeGreaterThan(0)

    expect(screen.getByText('OPS & ANALYTICS')).toBeTruthy()
    expect(screen.getByLabelText('System status')).toBeTruthy()

    const urls = fetchMock.mock.calls.map(([u]) => String(u))
    expect(urls).toContain('/api/dashboard/social')
    expect(
      urls.some((u) => u.startsWith('/api/dashboard/overview?days=30')),
    ).toBe(true)
  })

  it('opens one agent dialog when a left-column agent row is clicked', async () => {
    stubFetch()
    renderScreen()
    const row = await screen.findByRole('button', {
      name: /^neo, 311 sessions/,
    })
    fireEvent.click(row)
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1))
    expect(screen.getByRole('dialog').textContent).toContain('neo')
  })

  it('shows Unavailable columns but still renders ops and dock on a 500', async () => {
    const fetchMock = stubFetch(500)
    renderScreen()
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/dashboard/social'),
    )
    // let the failed query settle before asserting the fallback
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0)
    expect(screen.queryByText('Rohit')).toBeNull()
    expect(screen.getByText('OPS & ANALYTICS')).toBeTruthy()
    expect(screen.getByLabelText('System status')).toBeTruthy()
  })

  it('shows busy skeletons, never Unavailable, while the social query is pending', async () => {
    stubFetch(200, () => new Promise<Response>(() => undefined))
    renderScreen()
    const busy = await screen.findAllByRole('status')
    expect(busy).toHaveLength(3)
    for (const block of busy)
      expect(block.getAttribute('aria-busy')).toBe('true')
    expect(screen.queryByText('Unavailable')).toBeNull()
    // ops + dock do not wait for the social query
    expect(screen.getByText('OPS & ANALYTICS')).toBeTruthy()
  })

  it('shows Unavailable, not skeletons, for a null slice in a real response', async () => {
    stubFetch(200, () => Promise.resolve(json(mockDashboardSocialEmpty)))
    renderScreen()
    await waitFor(() =>
      expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0),
    )
    expect(document.querySelector('[aria-busy="true"]')).toBeNull()
  })

  it('refetches social and overview when the centre column reports a change', async () => {
    const fetchMock = stubFetch()
    renderScreen()
    const retry = await screen.findByRole('button', { name: 'RETRY NOW' })
    const count = (prefix: string) =>
      fetchMock.mock.calls.filter(([u]) => String(u).startsWith(prefix)).length
    await waitFor(() => expect(count('/api/dashboard/overview')).toBe(1))
    expect(count('/api/dashboard/social')).toBe(1)

    fireEvent.click(retry)

    await waitFor(() => expect(count('/api/dashboard/social')).toBe(2))
    await waitFor(() => expect(count('/api/dashboard/overview')).toBe(2))
    const post = fetchMock.mock.calls.find(([u]) =>
      String(u).startsWith('/api/claude-jobs/'),
    )
    expect(post?.[0]).toBe('/api/claude-jobs/cron_31?action=run')
    expect(post?.[1]?.method).toBe('POST')
  })

  it('feeds the sessions hour histogram and installed-skill count into the ops section', async () => {
    stubFetch()
    renderScreen()
    // installedCount: 2 skills from /api/skills
    await screen.findByText(/2 installed/)
    // hourHistogram: the "not loaded yet" tile is replaced once sessions load
    await waitFor(() =>
      expect(screen.queryByText(/Hour-of-day session data/)).toBeNull(),
    )
  })

  it('refetches the overview for 7 / 14 / 30 days when the ops period changes', async () => {
    const fetchMock = stubFetch()
    renderScreen()
    const overviewUrls = () =>
      fetchMock.mock.calls
        .map(([u]) => String(u))
        .filter((u) => u.startsWith('/api/dashboard/overview'))
    await waitFor(() =>
      expect(overviewUrls()).toContain(
        '/api/dashboard/overview?days=30&achievements=5',
      ),
    )

    for (const days of [7, 14, 30]) {
      fireEvent.click(await screen.findByRole('tab', { name: `${days}d` }))
      await waitFor(() =>
        expect(overviewUrls()).toContain(
          `/api/dashboard/overview?days=${days}&achievements=5`,
        ),
      )
      expect(window.localStorage.getItem('dashboard.analyticsPeriod')).toBe(
        String(days),
      )
      // the card remounts once the new period's overview resolves
      await waitFor(() =>
        expect(
          screen
            .getByRole('tab', { name: `${days}d` })
            .getAttribute('aria-selected'),
        ).toBe('true'),
      )
    }
  })
})

describe('useDashboardOverview retry cadence', () => {
  function Probe() {
    useDashboardOverview(30)
    return null
  }

  async function overviewCalls(
    payload: unknown,
    steps: Array<number>,
  ): Promise<Array<number>> {
    vi.useFakeTimers()
    const fetchMock = vi.fn(() => Promise.resolve(json(payload)))
    vi.stubGlobal('fetch', fetchMock)
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    })
    render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    )
    const counts: Array<number> = []
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    counts.push(fetchMock.mock.calls.length)
    for (const ms of steps) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms)
      })
      counts.push(fetchMock.mock.calls.length)
    }
    vi.useRealTimers()
    return counts
  }

  const full = {
    status: { gateway_state: 'running' },
    analytics: { source: 'analytics' },
  }

  it('partial response (analytics null) refetches every 5 s, 3 times, then 30 s', async () => {
    const counts = await overviewCalls(
      { status: full.status, analytics: null },
      [5_000, 5_000, 5_000, 5_000, 25_000, 5_000],
    )
    // initial, +3 fast retries, then the 4th 5 s step adds nothing,
    // and the 30 s poll lands after 30 s total from the last fetch.
    expect(counts).toEqual([1, 2, 3, 4, 4, 5, 5])
  })

  it('missing status also counts as partial', async () => {
    const counts = await overviewCalls(
      { status: null, analytics: full.analytics },
      [5_000],
    )
    expect(counts).toEqual([1, 2])
  })

  it('degraded analytics source counts as partial', async () => {
    const counts = await overviewCalls(
      { status: full.status, analytics: { source: 'fallback' } },
      [5_000],
    )
    expect(counts).toEqual([1, 2])
  })

  it('a full response waits the normal 30 s', async () => {
    const counts = await overviewCalls(full, [5_000, 20_000, 5_000])
    expect(counts).toEqual([1, 1, 1, 2])
  })
})
