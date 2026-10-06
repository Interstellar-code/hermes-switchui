// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useResumeRun } from './use-conductor-queries'
import type { ReactNode } from 'react'
import { useRetryRun } from '@/screens/workflows/use-workflows'

const h = vi.hoisted(() => ({ retry: vi.fn(), toast: vi.fn() }))
vi.mock('@/screens/workflows/api-client', async (orig) => ({
  ...(await orig<object>()),
  retryWorkflowRun: h.retry,
}))
vi.mock('@/components/ui/toast', () => ({ toast: h.toast }))

const conflict = (code: string) =>
  Object.assign(new Error('Run is still stopping — try again shortly'), {
    code,
  })

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useRetryRun', () => {
  it('a lost "already retried" race resolves as success', async () => {
    h.retry.mockRejectedValue(conflict('already_retried'))
    const { result } = renderHook(() => useRetryRun(), { wrapper: wrapper() })
    act(() => result.current.mutate({ runId: 'r1' }))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })
})

describe('useResumeRun', () => {
  it('live_owner reads as a "still stopping" toast', async () => {
    h.retry.mockRejectedValue(conflict('live_owner'))
    const { result } = renderHook(() => useResumeRun('r1'), {
      wrapper: wrapper(),
    })
    act(() => result.current.resume('r1', 'apply'))
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(
        'Still stopping — try again shortly',
        {
          type: 'error',
        },
      ),
    )
    expect(h.retry).toHaveBeenCalledWith('r1', { from_node_id: 'apply' })
  })

  it('pending is shared by every RESUME of the same run only', async () => {
    let done = () => {}
    h.retry.mockReturnValue(new Promise<void>((r) => (done = r)))
    const { result } = renderHook(
      () => ({
        a: useResumeRun('r1'),
        b: useResumeRun('r1'),
        other: useResumeRun('r2'),
      }),
      { wrapper: wrapper() },
    )
    act(() => result.current.a.resume('r1'))
    await waitFor(() => expect(result.current.b.isPending).toBe(true))
    expect(result.current.other.isPending).toBe(false)
    await act(async () => {
      done()
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.a.isPending).toBe(false))
  })
})
