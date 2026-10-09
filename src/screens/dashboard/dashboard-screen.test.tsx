// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardScreen } from './dashboard-screen'
import { mockDashboardSocial } from './social/mock'
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
  return Promise.resolve(new Response('not found', { status: 404 }))
}

const SESSIONS = {
  sessions: [
    { key: 's1', startedAt: Date.now() - 60_000 },
    { key: 's2', updatedAt: Date.now() - 120_000 },
  ],
}

function stubFetch(socialStatus = 200) {
  const overview = buildDashboardOverview({
    fetcher: overviewFetcher,
    analyticsWindowDays: 30,
  })
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith('/api/dashboard/social')) {
      return socialStatus === 200
        ? json(mockDashboardSocial)
        : new Response('boom', { status: socialStatus })
    }
    if (url.startsWith('/api/dashboard/overview')) {
      return json(await overview)
    }
    if (url.startsWith('/api/gateway-status')) {
      return json({ capabilities: { sessions: true, skills: true } })
    }
    if (url.startsWith('/api/sessions')) return json(SESSIONS)
    if (url.startsWith('/api/skills')) return json({ skills: [{}, {}] })
    return new Response('not found', { status: 404 })
  })
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
})
