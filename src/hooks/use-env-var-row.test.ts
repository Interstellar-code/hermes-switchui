// @vitest-environment jsdom
/**
 * `PUT`/`DELETE /api/env` reconcile the `.env` file, config.yaml mirrors, and
 * the auth.json credential pool in one shot (`EnvWriteResult`, see
 * `@/lib/hermes-client`). Before this fix the hook wrote through that
 * reconciling path but discarded the response, so a user rotating a key with
 * a config.yaml mirror had it silently rewritten with no feedback. These
 * tests cover the pure `describeReconciliation()` summarizer and the wiring
 * that surfaces its result as a follow-up toast.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describeReconciliation, useEnvVarRow } from './use-env-var-row'

const putEnvMock = vi.fn()
const deleteEnvMock = vi.fn()
const revealEnvMock = vi.fn()

vi.mock('@/lib/hermes-client', () => ({
  putEnv: (...args: Array<unknown>) => putEnvMock(...args),
  deleteEnv: (...args: Array<unknown>) => deleteEnvMock(...args),
  revealEnv: (...args: Array<unknown>) => revealEnvMock(...args),
}))

const toastMock = vi.fn()
vi.mock('@/components/ui/toast', () => ({
  toast: (...args: Array<unknown>) => toastMock(...args),
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function QueryClientWrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

describe('describeReconciliation', () => {
  it('returns null when the response reports nothing beyond plain success', () => {
    expect(describeReconciliation({ ok: true })).toBeNull()
  })

  it('surfaces rewritten config.yaml mirrors', () => {
    const result = describeReconciliation({
      config_updates: ['providers.manifest.key_env'],
    })
    expect(result).not.toBeNull()
    expect(result?.severity).toBe('info')
    expect(result?.message).toMatch(/config.yaml mirror/)
    expect(result?.message).toMatch(/providers\.manifest\.key_env/)
  })

  it('surfaces pruned credential-pool entries', () => {
    const result = describeReconciliation({ pool_pruned: ['openrouter'] })
    expect(result?.message).toMatch(/pruned/i)
    expect(result?.message).toMatch(/openrouter/)
  })

  it('flags an unreconciled write as a warning, not info', () => {
    const result = describeReconciliation({ credentialsReconciled: false })
    expect(result?.severity).toBe('warning')
    expect(result?.message).toMatch(/could not fully reconcile/i)
  })

  it('surfaces explicit warnings from the response as a warning', () => {
    const result = describeReconciliation({
      warnings: ['dashboard unreachable; wrote .env locally'],
    })
    expect(result?.severity).toBe('warning')
    expect(result?.message).toMatch(/dashboard unreachable/)
  })
})

describe('useEnvVarRow — reconciliation feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('toasts a follow-up note when saveEdit rewrites a config.yaml mirror', async () => {
    putEnvMock.mockResolvedValue({
      ok: true,
      config_updates: ['providers.manifest.key_env'],
    })
    const { result } = renderHook(() => useEnvVarRow('CUSTOM_API_KEY'), {
      wrapper: createWrapper(),
    })

    act(() => {
      result.current.setEditValue('sk-new-value')
    })
    await act(async () => {
      await result.current.saveEdit()
    })

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        'Custom Api Key updated',
        expect.objectContaining({ type: 'success' }),
      )
    })
    expect(toastMock).toHaveBeenCalledWith(
      expect.stringMatching(/config.yaml mirror/),
      expect.objectContaining({ type: 'info' }),
    )
  })

  it('does not toast a second message when the response is plain', async () => {
    putEnvMock.mockResolvedValue({ ok: true })
    const { result } = renderHook(() => useEnvVarRow('CUSTOM_API_KEY'), {
      wrapper: createWrapper(),
    })

    act(() => {
      result.current.setEditValue('sk-new-value')
    })
    await act(async () => {
      await result.current.saveEdit()
    })

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledTimes(1)
    })
  })

  it('toasts a warning on delete when the write could not be reconciled', async () => {
    deleteEnvMock.mockResolvedValue({ credentialsReconciled: false })
    const { result } = renderHook(() => useEnvVarRow('CUSTOM_API_KEY'), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.remove()
    })

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.stringMatching(/could not fully reconcile/i),
        expect.objectContaining({ type: 'warning' }),
      )
    })
  })
})
