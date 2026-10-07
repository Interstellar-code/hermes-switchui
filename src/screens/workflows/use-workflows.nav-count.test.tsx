// @vitest-environment jsdom
/**
 * QA2 F1-9 — the sidebar Workflows badge reads its own
 * `['nav-count','workflows']` query (60s staleTime); nothing refreshed it on
 * save/delete, so it drifted until reload. Every definitions writer must
 * invalidate that key too.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  useDeleteWorkflowDefinition,
  useUpsertWorkflowDefinition,
} from './use-workflows'

vi.mock('./api-client', () => ({
  deleteWorkflowDefinition: vi.fn().mockResolvedValue(undefined),
  upsertWorkflowDefinition: vi
    .fn()
    .mockResolvedValue({ definition: { id: 'wf-1' } }),
  resetWorkflowDefinitionToFactory: vi
    .fn()
    .mockResolvedValue({ definition: { id: 'wf-1' } }),
}))

afterEach(() => {
  cleanup()
})

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const spy = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { spy, wrapper }
}

describe('definitions writers refresh the sidebar badge (QA2 F1-9)', () => {
  it('useDeleteWorkflowDefinition invalidates nav-count workflows', async () => {
    const { spy, wrapper } = setup()
    const { result } = renderHook(() => useDeleteWorkflowDefinition(), {
      wrapper,
    })
    await act(async () => {
      await result.current.mutateAsync('wf-1')
    })
    await waitFor(() => {
      expect(
        spy.mock.calls.some(
          (call) =>
            JSON.stringify(call[0]?.queryKey) ===
            JSON.stringify(['nav-count', 'workflows']),
        ),
      ).toBe(true)
    })
  })

  it('useUpsertWorkflowDefinition invalidates nav-count workflows', async () => {
    const { spy, wrapper } = setup()
    const { result } = renderHook(() => useUpsertWorkflowDefinition(), {
      wrapper,
    })
    await act(async () => {
      await result.current.mutateAsync({
        id: 'wf-1',
        name: 'WF',
        yaml: 'name: WF\n',
        source: 'user',
      })
    })
    await waitFor(() => {
      expect(
        spy.mock.calls.some(
          (call) =>
            JSON.stringify(call[0]?.queryKey) ===
            JSON.stringify(['nav-count', 'workflows']),
        ),
      ).toBe(true)
    })
  })
})
