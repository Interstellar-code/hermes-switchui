// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  useEffectiveShowReasoning,
  useSessionReasoningStore,
} from './session-reasoning-store'
import { useChatSettingsStore } from '@/hooks/use-chat-settings'

/**
 * Real stores, real localStorage (jsdom) — nothing here mocks the store under
 * test. `useEffectiveShowReasoning` is exercised through `renderHook` so the
 * hook contract itself (override ?? global) is what's under test.
 */

function setGlobalShowReasoningBlocks(value: boolean) {
  useChatSettingsStore.setState({
    settings: {
      ...useChatSettingsStore.getState().settings,
      showReasoningBlocks: value,
    },
  })
}

beforeEach(() => {
  window.localStorage.clear()
  useSessionReasoningStore.setState({ overrides: {} })
  setGlobalShowReasoningBlocks(false)
})

afterEach(cleanup)

describe('useEffectiveShowReasoning', () => {
  it('returns the global default when no override is set (false and true)', () => {
    setGlobalShowReasoningBlocks(false)
    const off = renderHook(() => useEffectiveShowReasoning('chat:a'))
    expect(off.result.current).toBe(false)

    setGlobalShowReasoningBlocks(true)
    const on = renderHook(() => useEffectiveShowReasoning('chat:a'))
    expect(on.result.current).toBe(true)
  })

  it('returns the global value when no session key is given', () => {
    setGlobalShowReasoningBlocks(true)
    const noKey = renderHook(() => useEffectiveShowReasoning())
    expect(noKey.result.current).toBe(true)

    setGlobalShowReasoningBlocks(false)
    const noKeyOff = renderHook(() => useEffectiveShowReasoning(undefined))
    expect(noKeyOff.result.current).toBe(false)
  })

  it('an override wins over the global setting in both directions', () => {
    setGlobalShowReasoningBlocks(false)
    useSessionReasoningStore.getState().setOverride('chat:a', true)
    expect(
      renderHook(() => useEffectiveShowReasoning('chat:a')).result.current,
    ).toBe(true)

    setGlobalShowReasoningBlocks(true)
    useSessionReasoningStore.getState().setOverride('chat:b', false)
    expect(
      renderHook(() => useEffectiveShowReasoning('chat:b')).result.current,
    ).toBe(false)
  })

  it('overrides are per session key', () => {
    useSessionReasoningStore.getState().setOverride('chat:a', true)
    expect(
      renderHook(() => useEffectiveShowReasoning('chat:a')).result.current,
    ).toBe(true)
    // chat:b has no override and the global default is false
    expect(
      renderHook(() => useEffectiveShowReasoning('chat:b')).result.current,
    ).toBe(false)
  })

  it('clearOverride falls back to the global value', () => {
    setGlobalShowReasoningBlocks(true)
    useSessionReasoningStore.getState().setOverride('chat:a', false)
    expect(
      renderHook(() => useEffectiveShowReasoning('chat:a')).result.current,
    ).toBe(false)

    useSessionReasoningStore.getState().clearOverride('chat:a')
    expect(
      renderHook(() => useEffectiveShowReasoning('chat:a')).result.current,
    ).toBe(true)
    expect(useSessionReasoningStore.getState().overrides).toEqual({})
  })
})

describe('session-reasoning-store persistence', () => {
  it('persists overrides under the switchui:session-reasoning key', () => {
    useSessionReasoningStore.getState().setOverride('chat:a', true)

    const raw = window.localStorage.getItem('switchui:session-reasoning')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw ?? '{}') as {
      state?: { overrides?: Record<string, boolean> }
    }
    expect(parsed.state?.overrides).toEqual({ 'chat:a': true })
  })

  it('rehydrates overrides on a fresh module load and drops non-boolean junk', async () => {
    useSessionReasoningStore.getState().setOverride('chat:kept', true)
    useSessionReasoningStore.getState().setOverride('chat:kept-false', false)
    // Corrupt the persisted payload with non-boolean entries.
    const raw = window.localStorage.getItem('switchui:session-reasoning')
    const parsed = JSON.parse(raw ?? '{}') as {
      state?: { overrides?: Record<string, unknown> }
    }
    parsed.state = {
      ...parsed.state,
      overrides: {
        ...(parsed.state?.overrides ?? {}),
        'chat:junk': 'yes',
        'chat:null': null,
      },
    }
    window.localStorage.setItem(
      'switchui:session-reasoning',
      JSON.stringify(parsed),
    )

    // Fresh module instance → persist middleware rehydrates from localStorage.
    vi.resetModules()
    const { useSessionReasoningStore: fresh } =
      await import('./session-reasoning-store')
    expect(fresh.getState().overrides).toEqual({
      'chat:kept': true,
      'chat:kept-false': false,
    })
  })
})
