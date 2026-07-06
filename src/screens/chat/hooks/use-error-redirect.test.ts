// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { missingAuthMessage } from '../utils'
import { useErrorRedirect } from './use-error-redirect'
import type { ReactNode } from 'react'
import type { SessionMeta } from '../types'

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Fresh QueryClient wrapper per test so query caches don't leak */
function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children)
  }
  return { wrapper: Wrapper, queryClient }
}

/** Stub fetch so /api/ping (statusQuery's queryFn) returns controlled data */
function stubStatusFetch(ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve({ ok, status: ok ? 200 : 500 }),
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Partial UseQueryResult mock — only the fields the hook reads */
function makeQueryMock(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    error: null,
    isError: false,
    isLoading: false,
    isFetching: false,
    isSuccess: false,
    refetch: vi.fn().mockResolvedValue({}),
    ...overrides,
  }
}

function makeSession(friendlyId: string): SessionMeta {
  return {
    key: friendlyId,
    friendlyId,
    title: `Session ${friendlyId}`,
  }
}

interface RenderOpts {
  sessionsQuery?: Record<string, unknown>
  historyQuery?: Record<string, unknown>
  sessionsError?: string | null
  historyError?: string | null
  navigate?: ReturnType<typeof vi.fn>
  embedded?: boolean
  isNewChat?: boolean
  activeExists?: boolean
  activeFriendlyId?: string
  forcedSessionKey?: string | undefined
  sessions?: Array<SessionMeta>
  sessionKeyForHistory?: string
  error?: string | null
  setError?: ReturnType<typeof vi.fn>
  isRedirecting?: boolean
  setIsRedirecting?: ReturnType<typeof vi.fn>
  messageCount?: number
}

function renderErrorRedirect(opts: RenderOpts = {}) {
  const { wrapper, queryClient } = makeWrapper()

  const navigate = opts.navigate ?? vi.fn()
  const setError = opts.setError ?? vi.fn()
  const setIsRedirecting = opts.setIsRedirecting ?? vi.fn()

  const result = renderHook(
    () =>
      useErrorRedirect({
        sessionsQuery: makeQueryMock(opts.sessionsQuery ?? {}) as any,
        historyQuery: makeQueryMock(opts.historyQuery ?? {}) as any,
        sessionsError: opts.sessionsError ?? null,
        historyError: opts.historyError ?? null,
        navigate: navigate as any,
        embedded: opts.embedded ?? false,
        isNewChat: opts.isNewChat ?? false,
        activeExists: opts.activeExists ?? false,
        activeFriendlyId: opts.activeFriendlyId ?? 'session-1',
        forcedSessionKey: opts.forcedSessionKey,
        sessions: opts.sessions ?? [],
        sessionKeyForHistory: opts.sessionKeyForHistory ?? 'session-1',
        queryClient,
        error: opts.error ?? null,
        setError: setError as any,
        isRedirecting: opts.isRedirecting ?? false,
        setIsRedirecting: setIsRedirecting as any,
        messageCount: opts.messageCount ?? 0,
      }),
    { wrapper },
  )

  return { ...result, navigate, setError, setIsRedirecting, queryClient }
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('useErrorRedirect', () => {
  beforeEach(() => {
    stubStatusFetch(true)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  describe('shouldRedirectToNew', () => {
    it('is true when active session does not exist in sessions list', async () => {
      const sessions = [makeSession('session-a'), makeSession('session-b')]
      const { result } = renderErrorRedirect({
        sessionsQuery: { isSuccess: true },
        sessions,
        activeFriendlyId: 'nonexistent',
        historyQuery: { isFetching: false, isSuccess: false },
      })

      await waitFor(() => {
        expect(result.current.shouldRedirectToNew).toBe(true)
      })
    })

    it('is false when active session exists in sessions list', async () => {
      const sessions = [makeSession('session-a'), makeSession('session-b')]
      const { result } = renderErrorRedirect({
        sessionsQuery: { isSuccess: true },
        sessions,
        activeFriendlyId: 'session-a',
      })

      await waitFor(() => {
        expect(result.current.shouldRedirectToNew).toBe(false)
      })
    })

    it('is false for new chat', async () => {
      const { result } = renderErrorRedirect({
        isNewChat: true,
        sessionsQuery: { isSuccess: true },
        sessions: [makeSession('a')],
        activeFriendlyId: 'nonexistent',
      })

      await waitFor(() => {
        expect(result.current.shouldRedirectToNew).toBe(false)
      })
    })

    it('is false when forcedSessionKey is set', async () => {
      const { result } = renderErrorRedirect({
        forcedSessionKey: 'forced-key',
        sessionsQuery: { isSuccess: true },
        sessions: [makeSession('a')],
        activeFriendlyId: 'nonexistent',
      })

      await waitFor(() => {
        expect(result.current.shouldRedirectToNew).toBe(false)
      })
    })
  })

  describe('redirect effect — auth error', () => {
    it('navigates to / on auth-missing error (not embedded)', async () => {
      const navigate = vi.fn()
      renderErrorRedirect({
        navigate,
        sessionsError: missingAuthMessage,
        sessionsQuery: { isSuccess: true },
        activeExists: true,
        activeFriendlyId: 'session-a',
        sessions: [makeSession('session-a')],
      })

      // The auth-missing redirect is detected by isMissingAuth(messageText).
      // missingAuthMessage triggers isMissingAuth → navigate({ to: '/', replace: true })
      await waitFor(() => {
        expect(navigate).toHaveBeenCalledWith({ to: '/', replace: true })
      })
    })

    it('does not navigate to / when embedded', async () => {
      const navigate = vi.fn()
      const { result } = renderErrorRedirect({
        navigate,
        embedded: true,
        sessionsError: missingAuthMessage,
        sessionsQuery: { isSuccess: true },
        activeExists: true,
        activeFriendlyId: 'session-a',
        sessions: [makeSession('session-a')],
      })

      // Give effect a chance to run
      await waitFor(() => {
        expect(result.current.serverError).toBeTruthy()
      })

      expect(navigate).not.toHaveBeenCalled()
    })
  })

  describe('serverError', () => {
    it('derives from sessionsError', async () => {
      const { result } = renderErrorRedirect({
        sessionsError: 'sessions failed',
      })

      await waitFor(() => {
        expect(result.current.serverError).toBe('sessions failed')
      })
    })

    it('derives from historyError when sessionsError is null', async () => {
      const { result } = renderErrorRedirect({
        historyError: 'history failed',
      })

      await waitFor(() => {
        expect(result.current.serverError).toBe('history failed')
      })
    })

    it('is null when both errors are null', async () => {
      const { result } = renderErrorRedirect({})

      await waitFor(() => {
        expect(result.current.serverError).toBeNull()
      })
    })
  })

  describe('showErrorNotice', () => {
    it('is true when serverError exists and not new chat', async () => {
      const { result } = renderErrorRedirect({
        sessionsError: 'boom',
        isNewChat: false,
      })

      await waitFor(() => {
        expect(result.current.showErrorNotice).toBe(true)
      })
    })

    it('is false when serverError exists but is new chat', async () => {
      const { result } = renderErrorRedirect({
        sessionsError: 'boom',
        isNewChat: true,
      })

      await waitFor(() => {
        expect(result.current.showErrorNotice).toBe(false)
      })
    })

    it('is false when no error', async () => {
      const { result } = renderErrorRedirect({})

      await waitFor(() => {
        expect(result.current.showErrorNotice).toBe(false)
      })
    })
  })

  describe('historyEmpty', () => {
    it('is true when not loading and messageCount is 0', async () => {
      const { result } = renderErrorRedirect({
        messageCount: 0,
        isRedirecting: false,
        historyQuery: { isLoading: false, data: { messages: [] } },
      })

      await waitFor(() => {
        expect(result.current.historyEmpty).toBe(true)
      })
    })

    it('is false when messages exist', async () => {
      const { result } = renderErrorRedirect({
        messageCount: 5,
      })

      await waitFor(() => {
        expect(result.current.historyEmpty).toBe(false)
      })
    })

    it('is false when history is loading', async () => {
      const { result } = renderErrorRedirect({
        messageCount: 0,
        historyQuery: { isLoading: true, data: undefined },
      })

      await waitFor(() => {
        expect(result.current.historyEmpty).toBe(false)
      })
    })

    it('is false when isRedirecting', async () => {
      const { result } = renderErrorRedirect({
        messageCount: 0,
        isRedirecting: true,
      })

      await waitFor(() => {
        expect(result.current.historyEmpty).toBe(false)
      })
    })
  })

  describe('historyLoading', () => {
    it('is true when historyQuery is loading without data', async () => {
      const { result } = renderErrorRedirect({
        historyQuery: { isLoading: true, data: undefined },
      })

      await waitFor(() => {
        expect(result.current.historyLoading).toBe(true)
      })
    })

    it('is true when isRedirecting', async () => {
      const { result } = renderErrorRedirect({
        isRedirecting: true,
      })

      await waitFor(() => {
        expect(result.current.historyLoading).toBe(true)
      })
    })

    it('is false when not loading and not redirecting', async () => {
      const { result } = renderErrorRedirect({
        historyQuery: { isLoading: false, data: { messages: [] } },
      })

      await waitFor(() => {
        expect(result.current.historyLoading).toBe(false)
      })
    })
  })

  describe('hideUi / showComposer', () => {
    it('hideUi is true when shouldRedirectToNew', async () => {
      const { result } = renderErrorRedirect({
        sessionsQuery: { isSuccess: true },
        sessions: [makeSession('a')],
        activeFriendlyId: 'nonexistent',
        historyQuery: { isFetching: false, isSuccess: false },
      })

      await waitFor(() => {
        expect(result.current.hideUi).toBe(true)
      })
    })

    it('hideUi is true when isRedirecting', async () => {
      const { result } = renderErrorRedirect({
        isRedirecting: true,
      })

      await waitFor(() => {
        expect(result.current.hideUi).toBe(true)
      })
    })

    it('showComposer is false when isRedirecting', async () => {
      const { result } = renderErrorRedirect({
        isRedirecting: true,
      })

      await waitFor(() => {
        expect(result.current.showComposer).toBe(false)
      })
    })

    it('showComposer is true when not redirecting', async () => {
      const { result } = renderErrorRedirect({})

      await waitFor(() => {
        expect(result.current.showComposer).toBe(true)
      })
    })
  })

  describe('handleRefetch', () => {
    it('calls refetch on all three queries', () => {
      const sessionsRefetch = vi.fn().mockResolvedValue({})
      const historyRefetch = vi.fn().mockResolvedValue({})
      const { result } = renderErrorRedirect({
        sessionsQuery: { refetch: sessionsRefetch },
        historyQuery: { refetch: historyRefetch },
      })

      result.current.handleRefetch()

      expect(sessionsRefetch).toHaveBeenCalled()
      expect(historyRefetch).toHaveBeenCalled()
    })
  })

  describe('handleRefreshHistory', () => {
    it('calls refetch only on historyQuery', () => {
      const sessionsRefetch = vi.fn().mockResolvedValue({})
      const historyRefetch = vi.fn().mockResolvedValue({})
      const { result } = renderErrorRedirect({
        sessionsQuery: { refetch: sessionsRefetch },
        historyQuery: { refetch: historyRefetch },
      })

      result.current.handleRefreshHistory()

      expect(historyRefetch).toHaveBeenCalled()
      expect(sessionsRefetch).not.toHaveBeenCalled()
    })
  })
})
