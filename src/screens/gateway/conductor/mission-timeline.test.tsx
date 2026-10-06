// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MissionTimeline } from './mission-timeline'
import fixture from './__fixtures__/node-runs-agent-improve-loop-paused.json'
import { formatDuration } from './timeline-model'

let nodeRuns: Array<Record<string, unknown>> = []
vi.mock('@/screens/workflows/use-workflows', () => ({
  useWorkflowRun: (id: string | null) => ({
    data: id ? { run: {}, nodeRuns } : undefined,
  }),
}))

const T0 = Date.parse('2026-01-01T00:00:00Z')
const iso = (s: number) => new Date(T0 + s * 1000).toISOString()

describe('MissionTimeline', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0 + 100_000)
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('formats durations without mm:ss past an hour', () => {
    expect(formatDuration(5_000)).toBe('5s')
    expect(formatDuration(125_000)).toBe('2m 5s')
    expect(formatDuration(3_900_000)).toBe('1h 5m')
    expect(formatDuration((2 * 24 + 4) * 3_600_000)).toBe('2d 4h')
    expect(formatDuration(NaN)).toBe('—')
  })

  it('colours bars by node type', () => {
    nodeRuns = [
      {
        id: 'a',
        dag_node_id: 'plan',
        node_type: 'approval',
        status: 'completed',
        started_at: iso(0),
        completed_at: iso(10),
      },
    ]
    render(<MissionTimeline runId="r" />)
    const bar = screen.getByRole('img', { name: /plan/ })
    expect(bar.style.getPropertyValue('--node-c')).toBe('#ffb454')
  })

  it('shows empty state for null runId', () => {
    render(<MissionTimeline runId={null} />)
    expect(screen.getByText(/select a run/i)).toBeTruthy()
  })

  // ponytail: backend never writes loop_iteration yet (loop.py only emits
  // loop_iteration_* events); stacking activates once the backend patch lands.
  it('renders one row per node_run incl. stacked loop iterations', () => {
    nodeRuns = [
      {
        id: 'a',
        dag_node_id: 'plan',
        status: 'completed',
        started_at: iso(0),
        completed_at: iso(10),
      },
      {
        id: 'b',
        dag_node_id: 'loop',
        status: 'completed',
        started_at: iso(10),
        completed_at: iso(20),
        loop_iteration: 1,
      },
      {
        id: 'c',
        dag_node_id: 'loop',
        status: 'running',
        started_at: iso(20),
        completed_at: null,
        loop_iteration: 2,
      },
      {
        id: 'd',
        dag_node_id: 'report',
        status: 'pending',
        started_at: null,
        completed_at: null,
      },
    ]
    render(<MissionTimeline runId="r1" />)
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    expect(screen.getByText('loop · iteration 2')).toBeTruthy()
    expect(
      screen.getByLabelText('loop · iteration 2: running, 1m 20s'),
    ).toBeTruthy()
  })

  it('stacks real-shaped wrapper + iteration rows (iterations reference the wrapper)', () => {
    const base = { dag_node_id: 'loop', status: 'completed' }
    nodeRuns = [
      {
        ...base,
        id: 'w',
        started_at: iso(0),
        completed_at: iso(30),
        loop_iteration: null,
        total_tokens: 90,
      },
      ...[1, 2, 3].map((i) => ({
        ...base,
        id: `i${i}`,
        started_at: iso((i - 1) * 10),
        completed_at: iso(i * 10),
        loop_iteration: i,
        loop_parent_node_run_id: 'w',
        total_tokens: 30,
      })),
    ]
    render(<MissionTimeline runId="r1" />)
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    expect(screen.getByText('loop · iteration 3')).toBeTruthy()
  })

  it('switches scale locally, FIT default', () => {
    nodeRuns = []
    render(<MissionTimeline runId="r1" />)
    expect(screen.getByText('FIT').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByText('5M'))
    expect(screen.getByText('5M').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('FIT').getAttribute('aria-pressed')).toBe('false')
  })

  it('renders one row per node_run for the real paused fixture', () => {
    nodeRuns = fixture
    render(<MissionTimeline runId="r1" />)
    expect(screen.getAllByRole('listitem')).toHaveLength(fixture.length)
  })

  it('ticks while any row is open (paused included)', () => {
    const spy = vi.spyOn(globalThis, 'setInterval')
    nodeRuns = [
      {
        id: 'a',
        dag_node_id: 'n',
        status: 'paused',
        started_at: iso(0),
        completed_at: null,
      },
    ]
    render(<MissionTimeline runId="r1" />)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('ticks only while running', () => {
    const spy = vi.spyOn(globalThis, 'setInterval')
    nodeRuns = [
      {
        id: 'a',
        dag_node_id: 'n',
        status: 'completed',
        started_at: iso(0),
        completed_at: iso(5),
      },
    ]
    const { unmount } = render(<MissionTimeline runId="r1" />)
    expect(spy).not.toHaveBeenCalled()
    unmount()
    nodeRuns = [
      {
        id: 'a',
        dag_node_id: 'n',
        status: 'running',
        started_at: iso(0),
        completed_at: null,
      },
    ]
    render(<MissionTimeline runId="r1" />)
    expect(spy).toHaveBeenCalledTimes(1)
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.getByLabelText('n: running, 1m 42s')).toBeTruthy()
  })
})
