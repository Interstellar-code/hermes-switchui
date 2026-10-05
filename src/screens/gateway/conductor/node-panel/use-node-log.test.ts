// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useNodeLog } from './use-node-log'
import type { NodeLogListener } from '@/screens/workflows/use-workflow-events'

const h = vi.hoisted(() => ({ listRunEvents: vi.fn() }))
vi.mock('@/screens/workflows/api-client', () => ({
  listRunEvents: h.listRunEvents,
}))

const row = (seq: number, text: string, extra: object = {}) => ({
  seq,
  node_run_id: 'nr1',
  event_type: 'node_log',
  data: { stream: 'stdout', text, ...extra },
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useNodeLog', () => {
  it('merges history and live chunks by seq, deduped, other nodes ignored', async () => {
    h.listRunEvents.mockResolvedValue({
      events: [row(2, 'b\n'), row(1, 'a\n')],
      cursor: 2,
    })
    let push: NodeLogListener = () => {}
    const subscribe = vi.fn((fn: NodeLogListener) => {
      push = fn
      return () => {}
    })
    const { result } = renderHook(() =>
      useNodeLog({
        runId: 'r1',
        nodeRunId: 'nr1',
        enabled: true,
        live: true,
        subscribe,
      }),
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(h.listRunEvents).toHaveBeenCalledWith('r1', {
      type: 'node_log',
      node_run_id: 'nr1',
      after: '0',
      limit: 1000,
    })
    act(() => {
      push(row(2, 'b\n')) // duplicate of history
      push({ ...row(3, 'c\n', { stream: 'stderr' }) })
      push({ ...row(4, 'x\n'), node_run_id: 'other' })
      push(row(5, '', { truncated: true }))
    })
    await waitFor(() => expect(result.current.chunks).toHaveLength(3))
    expect(result.current.chunks.map((c) => [c.seq, c.stream])).toEqual([
      [1, 'stdout'],
      [2, 'stdout'],
      [3, 'stderr'],
    ])
    expect(result.current.truncated).toBe(true)
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
