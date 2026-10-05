// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConductorTopBar, formatTick } from './conductor-top-bar'

const state = vi.hoisted(() => ({ data: undefined as object | undefined }))
vi.mock('./use-conductor-queries', () => ({
  useConductorState: () => ({ data: state.data }),
  useConductorScheduled: () => ({ data: undefined }),
}))

function renderBar() {
  const qc = new QueryClient()
  const spy = vi.spyOn(qc, 'invalidateQueries')
  render(
    <QueryClientProvider client={qc}>
      <ConductorTopBar />
    </QueryClientProvider>,
  )
  return spy
}

const base = {
  live: 0,
  needsYou: 1,
  nodesRunning: 3,
  oldestLiveElapsed: '—',
  tokens: '—',
  totalTokens: 0,
  oldestLiveStartedAt: null,
  runsToday: 1,
}

describe('ConductorTopBar', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('shows 0 tokens, none for oldest live, no Theme button', () => {
    state.data = base
    renderBar()
    expect(screen.getByText('none')).toBeTruthy()
    expect(screen.getByText('tok used').previousSibling?.textContent).toBe('0')
    expect(screen.queryByTitle('Theme')).toBeNull()
  })

  it('ticks OLDEST LIVE every second', () => {
    state.data = { ...base, live: 1, oldestLiveStartedAt: Date.now() - 5000 }
    renderBar()
    expect(screen.getByText('00:05')).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.getByText('00:07')).toBeTruthy()
  })

  it('Refresh invalidates conductor and workflow-runs', () => {
    state.data = base
    const spy = renderBar()
    fireEvent.click(screen.getByLabelText('Refresh'))
    const keys = spy.mock.calls.map(
      (c) => (c[0] as { queryKey: Array<string> }).queryKey[0],
    )
    expect(keys).toEqual(['conductor', 'workflow-runs'])
  })

  it('formatTick', () => {
    expect(formatTick(65_000)).toBe('01:05')
    expect(formatTick(3_700_000)).toBe('1h 1m')
  })
})
