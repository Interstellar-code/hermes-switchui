// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsChartCard } from './analytics-chart-card'
import { CacheEfficiencyCard } from './cache-efficiency-card'
import { TopModelsCard } from './top-models-card'
import { CardPlaceholder } from './widget-shell'
import type { DashboardOverview } from '@/server/dashboard-aggregator'
import { buildDashboardOverview } from '@/server/dashboard-aggregator'

type Analytics = NonNullable<DashboardOverview['analytics']>

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function analytics(over: Partial<Analytics> = {}): Analytics {
  return {
    windowDays: 7,
    totalTokens: 1000,
    inputTokens: 400,
    outputTokens: 600,
    cacheReadTokens: 800,
    reasoningTokens: 0,
    totalSessions: 3,
    totalApiCalls: 10,
    topModels: [
      { id: 'sonnet-4.5', tokens: 1000, calls: 10, cost: 0.5, sessions: 3 },
    ],
    daily: [
      {
        day: '2026-10-08',
        inputTokens: 400,
        outputTokens: 600,
        cacheReadTokens: 800,
        reasoningTokens: 0,
        sessions: 3,
        apiCalls: 10,
        estimatedCost: 0.5,
      },
    ],
    estimatedCostUsd: 0.5,
    costLabel: 'precise',
    source: 'analytics',
    ...over,
  }
}

const noop = () => undefined

// [title, render(analytics, loading)] for the three cards that used to
// `return null` and leave a hole in the Ops grid.
const CARDS: Array<
  [string, (a: DashboardOverview['analytics'], loading?: boolean) => unknown]
> = [
  [
    'AnalyticsChartCard',
    (a, loading) =>
      render(
        <AnalyticsChartCard
          analytics={a}
          insights={[]}
          period={7}
          onPeriodChange={noop}
          loading={loading}
        />,
      ),
  ],
  [
    'TopModelsCard',
    (a, loading) => render(<TopModelsCard analytics={a} loading={loading} />),
  ],
  [
    'CacheEfficiencyCard',
    (a, loading) =>
      render(<CacheEfficiencyCard analytics={a} loading={loading} />),
  ],
]

describe.each(CARDS)('%s never vanishes', (_name, mount) => {
  it('pending → "Loading…" with aria-busy', () => {
    const { container } = mount(null, true) as ReturnType<typeof render>
    expect(screen.getByText('Loading…')).toBeTruthy()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it('analytics null → Unavailable, not busy', () => {
    const { container } = mount(null) as ReturnType<typeof render>
    expect(
      screen.getByText(/Unavailable — analytics did not load/),
    ).toBeTruthy()
    expect(container.querySelector('[aria-busy="true"]')).toBeNull()
  })

  it('renders something (a titled shell) for every state', () => {
    const { container } = mount(null) as ReturnType<typeof render>
    expect(container.firstChild).not.toBeNull()
    expect(container.querySelector('h3')).not.toBeNull()
  })
})

describe('empty-but-answered states', () => {
  it.each([
    ['TopModelsCard', TopModelsCard],
    ['CacheEfficiencyCard', CacheEfficiencyCard],
  ])('%s with source unavailable → Unavailable', (_n, Card) => {
    render(<Card analytics={analytics({ source: 'unavailable' })} />)
    expect(
      screen.getByText(/Unavailable — analytics did not load/),
    ).toBeTruthy()
  })

  it('AnalyticsChartCard with source unavailable keeps its titled shell', () => {
    render(
      <AnalyticsChartCard
        analytics={analytics({ source: 'unavailable', daily: [] })}
        insights={[]}
        period={7}
        onPeriodChange={noop}
      />,
    )
    expect(screen.getByText(/Usage trend · 7d/)).toBeTruthy()
  })

  it('TopModelsCard with zero models → "No data in this window"', () => {
    render(<TopModelsCard analytics={analytics({ topModels: [] })} />)
    expect(screen.getByText('No data in this window')).toBeTruthy()
    expect(screen.getByText(/Top models/)).toBeTruthy()
  })

  it('CacheEfficiencyCard with zero cache+input → "No data in this window"', () => {
    render(
      <CacheEfficiencyCard
        analytics={analytics({ cacheReadTokens: 0, inputTokens: 0 })}
      />,
    )
    expect(screen.getByText('No data in this window')).toBeTruthy()
  })

  it('populated analytics still renders the real cards', () => {
    render(<TopModelsCard analytics={analytics()} />)
    expect(screen.getByText('1 ranked')).toBeTruthy()
    cleanup()
    render(<CacheEfficiencyCard analytics={analytics()} />)
    expect(screen.getByText('hit rate')).toBeTruthy()
  })
})

describe('overview aggregator timeout', () => {
  it('waits 8000 ms for a slow upstream before giving up', async () => {
    vi.useFakeTimers()
    const hang = () => new Promise<Response>(() => undefined)
    let settled = false
    const p = buildDashboardOverview({ fetcher: hang }).then((o) => {
      settled = true
      return o
    })
    await vi.advanceTimersByTimeAsync(7_999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const overview = await p
    expect(settled).toBe(true)
    expect(overview.analytics).toBeNull()
    expect(overview.status).toBeNull()
  })
})

describe('CardPlaceholder', () => {
  it('unavailable text is generic unless a message is passed', () => {
    const { rerender } = render(
      <CardPlaceholder title="X" state="unavailable" />,
    )
    expect(screen.getByText('Data did not load. Retrying…')).toBeTruthy()
    rerender(<CardPlaceholder title="X" state="unavailable" message="Custom" />)
    expect(screen.getByText('Custom')).toBeTruthy()
  })
})
