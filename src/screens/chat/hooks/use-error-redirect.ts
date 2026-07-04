import { useCallback, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { QueryClient, UseQueryResult } from '@tanstack/react-query'

import {
  clearHistoryMessages,
  fetchStatus,
  type StatusResponse,
} from '../chat-queries'
import {
  isMissingAuth,
} from '../utils'
import {
  isRecentSession,
  resetPendingSend,
} from '../pending-send'
import type { SessionMeta } from '../types'

/**
 * Navigate options accepted by the hook. Mirrors the subset of TanStack Router's
 * NavigateOptions that the redirect effects use.
 */
type NavigateOpts = {
  to: string
  replace?: boolean
  params?: Record<string, string | undefined>
}

/**
 * Extracts error-handling, session-redirect, and derived UI-flag logic out of
 * ChatScreen. Pure move — no behavior change.
 *
 * Owns:
 * - statusQuery (health probe)
 * - Derived error signals (serverError, serverErrorStatus, showErrorNotice)
 * - Refetch callbacks (handleRefetch, handleRefreshHistory)
 * - shouldRedirectToNew computation
 * - 3 redirect effects (auth-missing, cancel, redirect-to-latest)
 * - Derived UI flags (hideUi, showComposer, historyLoading, historyEmpty)
 *
 * Does NOT own the `error`/`isRedirecting` state — those are shared with other
 * ChatScreen concerns (useChatHistory reads isRedirecting; handleSwitchModel
 * writes setError) so they remain in the parent and are passed in.
 */
export function useErrorRedirect(params: {
  // Queries
  sessionsQuery: UseQueryResult
  historyQuery: UseQueryResult
  sessionsError: string | null
  historyError: string | null

  // Session routing
  navigate: (opts: NavigateOpts) => void
  embedded: boolean
  isNewChat: boolean
  activeExists: boolean
  activeFriendlyId: string
  forcedSessionKey: string | undefined
  sessions: Array<SessionMeta>
  sessionKeyForHistory: string

  // Cache
  queryClient: QueryClient

  // Shared state (owned by parent — see JSDoc above)
  error: string | null
  setError: (value: string | null) => void
  isRedirecting: boolean
  setIsRedirecting: (value: boolean) => void

  // Display
  messageCount: number
}): {
  statusQuery: UseQueryResult<StatusResponse>
  serverError: string | null
  serverErrorStatus: number | undefined
  showErrorNotice: boolean
  handleRefetch: () => void
  handleRefreshHistory: () => void
  shouldRedirectToNew: boolean
  isRedirecting: boolean
  hideUi: boolean
  showComposer: boolean
  historyLoading: boolean
  historyEmpty: boolean
} {
  const {
    sessionsQuery,
    historyQuery,
    sessionsError,
    historyError,
    navigate,
    embedded,
    isNewChat,
    activeExists,
    activeFriendlyId,
    forcedSessionKey,
    sessions,
    sessionKeyForHistory,
    queryClient,
    error,
    setError,
    isRedirecting,
    setIsRedirecting,
    messageCount,
  } = params

  const statusQuery = useQuery({
    queryKey: ['claude', 'status'],
    queryFn: fetchStatus,
    retry: 2,
    retryDelay: 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: true,
    staleTime: 30_000,
    refetchInterval: 60_000, // Re-check every 60s to clear stale errors
  })
  const serverError = sessionsError ?? historyError
  const serverErrorStatus: number | undefined = undefined
  const showErrorNotice = Boolean(serverError) && !isNewChat
  const handleRefetch = useCallback(() => {
    void statusQuery.refetch()
    void sessionsQuery.refetch()
    void historyQuery.refetch()
  }, [statusQuery, sessionsQuery, historyQuery])

  const handleRefreshHistory = useCallback(() => {
    void historyQuery.refetch()
  }, [historyQuery])

  const shouldRedirectToNew =
    !isNewChat &&
    !forcedSessionKey &&
    !isRecentSession(activeFriendlyId) &&
    sessionsQuery.isSuccess &&
    sessions.length > 0 &&
    !sessions.some((session) => session.friendlyId === activeFriendlyId) &&
    !historyQuery.isFetching &&
    !historyQuery.isSuccess

  useEffect(() => {
    if (isRedirecting) {
      if (error) setError(null)
      return
    }
    if (shouldRedirectToNew) {
      if (error) setError(null)
      return
    }
    if (
      sessionsQuery.isSuccess &&
      !activeExists &&
      !sessionsError &&
      !historyError
    ) {
      if (error) setError(null)
      return
    }
    const messageText = sessionsError ?? historyError
    if (!messageText) {
      if (error?.startsWith('Failed to load')) {
        setError(null)
      }
      return
    }
    if (isMissingAuth(messageText) && !embedded) {
      navigate({ to: '/', replace: true })
    }
    const message = sessionsError
      ? `Failed to load sessions. ${sessionsError}`
      : historyError
        ? `Failed to load history. ${historyError}`
        : null
    if (message) setError(message)
  }, [
    activeExists,
    error,
    historyError,
    isRedirecting,
    navigate,
    sessionsError,
    sessionsQuery.isSuccess,
    shouldRedirectToNew,
  ])

  useEffect(() => {
    if (!isRedirecting) return
    if (isNewChat) {
      setIsRedirecting(false)
      return
    }
    if (!shouldRedirectToNew && sessionsQuery.isSuccess) {
      setIsRedirecting(false)
    }
  }, [isNewChat, isRedirecting, sessionsQuery.isSuccess, shouldRedirectToNew])

  useEffect(() => {
    if (embedded) return
    if (isNewChat) return
    if (!sessionsQuery.isSuccess) return
    if (sessions.length === 0) return
    if (!shouldRedirectToNew) return
    resetPendingSend()
    clearHistoryMessages(queryClient, activeFriendlyId, sessionKeyForHistory)
    const latestSession = sessions[0]?.friendlyId ?? 'new'
    navigate({
      to: '/chat/$sessionKey',
      params: { sessionKey: latestSession },
      replace: true,
    })
  }, [
    activeFriendlyId,
    historyQuery.isFetching,
    historyQuery.isSuccess,
    isNewChat,
    navigate,
    queryClient,
    sessionKeyForHistory,
    sessions,
    sessionsQuery.isSuccess,
    shouldRedirectToNew,
    embedded,
  ])

  const hideUi = shouldRedirectToNew || isRedirecting
  const showComposer = !isRedirecting

  const historyLoading =
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime safety
    (historyQuery.isLoading && !historyQuery.data) || isRedirecting
  const historyEmpty = !historyLoading && messageCount === 0

  return {
    statusQuery,
    serverError,
    serverErrorStatus,
    showErrorNotice,
    handleRefetch,
    handleRefreshHistory,
    shouldRedirectToNew,
    isRedirecting,
    hideUi,
    showComposer,
    historyLoading,
    historyEmpty,
  }
}
