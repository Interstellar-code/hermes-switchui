// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import {
  PAGE,
  addChunk,
  capStore,
  newStore,
  toChunk,
  useNodeLog,
} from './use-node-log'
import type { NodeLogListener } from '@/screens/workflows/use-workflow-events'

const h = vi.hoisted(() => ({ listRunEvents: vi.fn() }))
vi.mock('@/screens/workflows/api-client', () => ({
  listRunEvents: h.listRunEvents,
}))

const row = (
  seq: number | null,
  text: string,
  extra: object = {},
  nodeRunId = 'nr1',
) => ({
  seq,
  node_run_id: nodeRunId,
  event_type: 'node_log',
  data: { stream: 'stdout', text, ...extra },
})

function liveSource() {
  const src = {
    push: (() => {}) as NodeLogListener,
    subscribe: vi.fn((fn: NodeLogListener) => {
      src.push = fn
      return () => {}
    }),
  }
  return src
}

type Props = { nodeRunId: string; live: boolean }
function render(
  initial: Props,
  subscribe?: ReturnType<typeof liveSource>['subscribe'],
) {
  return renderHook(
    (p: Props) =>
      useNodeLog({
        runId: 'r1',
        nodeRunId: p.nodeRunId,
        enabled: true,
        live: p.live,
        subscribe,
      }),
    { initialProps: initial },
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('useNodeLog', () => {
  it('subscribes to live chunks before fetching history', async () => {
    const order: Array<string> = []
    const src = liveSource()
    src.subscribe.mockImplementation((fn) => {
      order.push('subscribe')
      src.push = fn
      return () => {}
    })
    h.listRunEvents.mockImplementation(() => {
      order.push('history')
      return Promise.resolve({ events: [], cursor: null })
    })
    const { result } = render({ nodeRunId: 'nr1', live: true }, src.subscribe)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(order).toEqual(['subscribe', 'history'])
  })

  it('loads the newest page first, then merges live chunks deduped by seq', async () => {
    h.listRunEvents.mockResolvedValue({
      events: [row(1, 'a\n'), row(2, 'b\n')],
      cursor: 2,
    })
    const src = liveSource()
    const { result } = render({ nodeRunId: 'nr1', live: true }, src.subscribe)
    await waitFor(() => expect(result.current.loading).toBe(false))
    // Newest-first: no `after` on the initial load.
    expect(h.listRunEvents).toHaveBeenCalledWith('r1', {
      type: 'node_log',
      node_run_id: 'nr1',
      limit: PAGE,
    })
    expect(result.current.hasEarlier).toBe(false)
    act(() => {
      src.push(row(2, 'b\n')) // duplicate of history
      src.push(row(3, 'c\n', { stream: 'stderr' }))
      src.push(row(4, 'x\n', {}, 'other'))
      src.push(row(null, 'n1\n')) // DB write dropped: no seq
      src.push(row(null, 'n2\n'))
      src.push(row(5, '', { truncated: true }))
    })
    await waitFor(() => expect(result.current.chunks).toHaveLength(6))
    expect(
      result.current.chunks.map((c) => [c.key, c.stream, c.truncated]),
    ).toEqual([
      ['1', 'stdout', false],
      ['2', 'stdout', false],
      ['3', 'stderr', false],
      ['n1', 'stdout', false],
      ['n2', 'stdout', false],
      ['5', 'stdout', true],
    ])
  })

  it('catches up from the cursor when the node stops', async () => {
    h.listRunEvents.mockResolvedValueOnce({
      events: [row(10, 'a\n'), row(11, 'b\n')],
      cursor: 11,
    })
    const { result, rerender } = render(
      { nodeRunId: 'nr1', live: true },
      liveSource().subscribe,
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    h.listRunEvents.mockResolvedValueOnce({
      events: [row(12, 'c\n')],
      cursor: 12,
    })
    rerender({ nodeRunId: 'nr1', live: false })
    await waitFor(() => expect(result.current.chunks).toHaveLength(3))
    expect(h.listRunEvents).toHaveBeenLastCalledWith('r1', {
      type: 'node_log',
      node_run_id: 'nr1',
      limit: PAGE,
      after: '11',
    })
  })

  it('a full newest page offers LOAD EARLIER, which pages forward up to the window', async () => {
    const newest = Array.from({ length: PAGE }, (_, i) =>
      row(5000 + i, `n${i}\n`),
    )
    h.listRunEvents.mockResolvedValueOnce({ events: newest, cursor: 5999 })
    const { result } = render({ nodeRunId: 'nr1', live: false })
    await waitFor(() => expect(result.current.hasEarlier).toBe(true))
    h.listRunEvents.mockResolvedValueOnce({
      events: [row(7, 'old1\n'), row(8, 'old2\n'), row(5000, 'n0\n')],
      cursor: 5000,
    })
    act(() => result.current.loadEarlier())
    await waitFor(() => expect(result.current.hasEarlier).toBe(false))
    expect(h.listRunEvents).toHaveBeenLastCalledWith('r1', {
      type: 'node_log',
      node_run_id: 'nr1',
      limit: PAGE,
      after: '0',
    })
    expect(result.current.chunks).toHaveLength(PAGE + 2)
    expect(result.current.chunks.slice(0, 3).map((c) => c.seq)).toEqual([
      7, 8, 5000,
    ])
  })

  it('resets when the node run changes', async () => {
    h.listRunEvents.mockResolvedValueOnce({ events: [row(1, 'a\n')] })
    const { result, rerender } = render({ nodeRunId: 'nr1', live: false })
    await waitFor(() => expect(result.current.chunks).toHaveLength(1))
    h.listRunEvents.mockResolvedValueOnce({
      events: [row(2, 'z\n', {}, 'nr2')],
    })
    rerender({ nodeRunId: 'nr2', live: false })
    await waitFor(() =>
      expect(result.current.chunks.map((c) => c.text)).toEqual(['z\n']),
    )
    expect(h.listRunEvents).toHaveBeenLastCalledWith(
      'r1',
      expect.objectContaining({ node_run_id: 'nr2' }),
    )
  })

  it('clears the pending flush timer on unmount', async () => {
    vi.useFakeTimers()
    h.listRunEvents.mockResolvedValue({ events: [] })
    const src = liveSource()
    const { unmount } = render({ nodeRunId: 'nr1', live: true }, src.subscribe)
    await act(async () => {})
    act(() => src.push(row(1, 'a\n')))
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does nothing when disabled', () => {
    renderHook(() =>
      useNodeLog({
        runId: 'r1',
        nodeRunId: 'nr1',
        enabled: false,
        live: false,
      }),
    )
    expect(h.listRunEvents).not.toHaveBeenCalled()
  })
})

describe('log store', () => {
  it('binary-inserts an out-of-order seq and keeps seq-less chunks after their predecessor', () => {
    const st = newStore()
    addChunk(st, toChunk(row(1, 'a'), 'nr1'))
    addChunk(st, toChunk(row(3, 'c'), 'nr1'))
    addChunk(st, toChunk(row(null, 'n'), 'nr1'))
    addChunk(st, toChunk(row(2, 'b'), 'nr1'))
    expect(st.list.map((c) => c.text).join('')).toBe('abcn')
  })

  it('drops the oldest output over the cap and flags it', () => {
    const st = newStore()
    for (let i = 1; i <= 4; i++) addChunk(st, toChunk(row(i, 'xxxx'), 'nr1'))
    st.hasEarlier = true
    capStore(st, 10)
    expect(st.list.map((c) => c.seq)).toEqual([3, 4])
    expect(st.dropped).toBe(true)
    expect(st.hasEarlier).toBe(false)
  })
})
