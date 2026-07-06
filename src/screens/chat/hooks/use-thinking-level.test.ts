// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { useThinkingLevel } from './use-thinking-level'
import type { ReactNode } from 'react'

// ─── helpers ──────────────────────────────────────────────────────────────────

const FRIENDLY_ID = 'test-session'
const STORAGE_KEY = `claude-thinking-${FRIENDLY_ID}`

/** Fresh QueryClient wrapper per test so query caches don't leak */
function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children)
  }
  return Wrapper
}

/** Stub fetch so /api/models and /api/session-status return controlled data */
function stubFetch({
  model = '',
  models = [] as Array<{ id: string }>,
} = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/models') {
        return { ok: true, json: async () => ({ models }) }
      }
      if (url === '/api/session-status') {
        return { ok: true, json: async () => ({ model }) }
      }
      return { ok: false, json: async () => ({}) }
    }),
  )
}

function defaultParams(overrides?: {
  activeFriendlyId?: string
  resolvedSessionKey?: string
  forcedSessionKey?: string
}) {
  return {
    activeFriendlyId: FRIENDLY_ID,
    resolvedSessionKey: undefined as string | undefined,
    forcedSessionKey: undefined as string | undefined,
    ...overrides,
  }
}

// ─── test lifecycle ────────────────────────────────────────────────────────────

beforeEach(() => {
  sessionStorage.clear()
  stubFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ─── one-shot sessionStorage init ─────────────────────────────────────────────

describe('one-shot sessionStorage init', () => {
  it('defaults to "low" when no value is stored', () => {
    const { result } = renderHook(() => useThinkingLevel(defaultParams()), {
      wrapper: makeWrapper(),
    })
    expect(result.current.thinkingLevel).toBe('low')
  })

  it('reads "adaptive" from sessionStorage on first mount', () => {
    sessionStorage.setItem(STORAGE_KEY, 'adaptive')
    const { result } = renderHook(() => useThinkingLevel(defaultParams()), {
      wrapper: makeWrapper(),
    })
    expect(result.current.thinkingLevel).toBe('adaptive')
  })

  it('reads "off" from sessionStorage on first mount', () => {
    sessionStorage.setItem(STORAGE_KEY, 'off')
    const { result } = renderHook(() => useThinkingLevel(defaultParams()), {
      wrapper: makeWrapper(),
    })
    expect(result.current.thinkingLevel).toBe('off')
  })

  it('ignores unknown stored values and falls back to "low"', () => {
    sessionStorage.setItem(STORAGE_KEY, 'turbo')
    const { result } = renderHook(() => useThinkingLevel(defaultParams()), {
      wrapper: makeWrapper(),
    })
    expect(result.current.thinkingLevel).toBe('low')
  })
})

// ─── handleThinkingLevelChange ────────────────────────────────────────────────

describe('handleThinkingLevelChange', () => {
  it('updates thinkingLevel state', () => {
    const { result } = renderHook(() => useThinkingLevel(defaultParams()), {
      wrapper: makeWrapper(),
    })
    act(() => {
      result.current.handleThinkingLevelChange('adaptive')
    })
    expect(result.current.thinkingLevel).toBe('adaptive')
  })

  it('writes the new level to sessionStorage', () => {
    const { result } = renderHook(() => useThinkingLevel(defaultParams()), {
      wrapper: makeWrapper(),
    })
    act(() => {
      result.current.handleThinkingLevelChange('off')
    })
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe('off')
  })
})

// ─── E30 auto-adaptive for Claude 4.6 ─────────────────────────────────────────

describe('E30 auto-adaptive (claude-4.6)', () => {
  it('sets "adaptive" when model contains "4-6" and nothing is stored', async () => {
    stubFetch({ model: 'claude-4-6-sonnet-20250514' })
    const { result } = renderHook(() => useThinkingLevel(defaultParams()), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => {
      expect(result.current.thinkingLevel).toBe('adaptive')
    })
  })

  it('sets "adaptive" when model contains "claude-4.6" and nothing is stored', async () => {
    stubFetch({ model: 'claude-4.6-sonnet' })
    const { result } = renderHook(() => useThinkingLevel(defaultParams()), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => {
      expect(result.current.thinkingLevel).toBe('adaptive')
    })
  })

  it('does NOT override a stored value even for a 4.6 model', async () => {
    sessionStorage.setItem(STORAGE_KEY, 'off')
    stubFetch({ model: 'claude-4-6-sonnet-20250514' })
    const { result } = renderHook(() => useThinkingLevel(defaultParams()), {
      wrapper: makeWrapper(),
    })
    // Wait for model query to resolve and E30 to run
    await waitFor(() => {
      expect(result.current.currentModel).toBeTruthy()
    })
    // Stored 'off' must survive — E30 must NOT override it
    expect(result.current.thinkingLevel).toBe('off')
  })

  it('does not auto-set adaptive for a non-4.6 model', async () => {
    stubFetch({ model: 'claude-3-5-sonnet-20241022' })
    const { result } = renderHook(() => useThinkingLevel(defaultParams()), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => {
      expect(result.current.currentModel).toBeTruthy()
    })
    expect(result.current.thinkingLevel).toBe('low')
  })

  /**
   * Critical one-shot guard: thinkingInitializedRef is NOT reset when
   * activeFriendlyId changes. Even though E30 has [currentModel, activeFriendlyId]
   * in its dep array, the guard short-circuits on the second run.
   */
  it('one-shot guard: does NOT re-initialize when activeFriendlyId changes', async () => {
    stubFetch({ model: 'claude-4-6-sonnet-20250514' })
    const { result, rerender } = renderHook(
      (props: { activeFriendlyId: string }) =>
        useThinkingLevel({
          activeFriendlyId: props.activeFriendlyId,
          resolvedSessionKey: undefined,
          forcedSessionKey: undefined,
        }),
      {
        initialProps: { activeFriendlyId: FRIENDLY_ID },
        wrapper: makeWrapper(),
      },
    )

    // E30 fires → adaptive (no stored value)
    await waitFor(() => {
      expect(result.current.thinkingLevel).toBe('adaptive')
    })

    // User explicitly changes to 'off' → guard already set
    act(() => {
      result.current.handleThinkingLevelChange('off')
    })
    expect(result.current.thinkingLevel).toBe('off')

    // Simulate session switch by changing activeFriendlyId
    rerender({ activeFriendlyId: 'other-session' })

    // Guard is still set → E30 returns early → thinkingLevel stays 'off'
    // (no re-read from sessionStorage, no re-initialization to 'adaptive')
    expect(result.current.thinkingLevel).toBe('off')
  })
})

// ─── availableModelIds ────────────────────────────────────────────────────────

describe('availableModelIds', () => {
  it('maps model ids from the /api/models response', async () => {
    stubFetch({
      models: [
        { id: 'claude-3-5-sonnet-20241022' },
        { id: 'claude-4-6-sonnet-20250514' },
      ],
    })
    const { result } = renderHook(() => useThinkingLevel(defaultParams()), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => {
      expect(result.current.availableModelIds).toHaveLength(2)
    })
    expect(result.current.availableModelIds).toEqual([
      'claude-3-5-sonnet-20241022',
      'claude-4-6-sonnet-20250514',
    ])
  })

  it('returns empty array when /api/models responds with not-ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    )
    const { result } = renderHook(() => useThinkingLevel(defaultParams()), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => {
      expect(result.current.modelsQuery.isSuccess).toBe(true)
    })
    expect(result.current.availableModelIds).toEqual([])
  })
})
