import {
  createFileRoute,
  retainSearchParams,
  useNavigate,
} from '@tanstack/react-router'
import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import {
  chatQueryKeys,
  moveHistoryMessages,
  reconcileSessionDraft,
} from '../../screens/chat/chat-queries'
import { invalidateSessionLists } from '../../screens/chat/sessions-feed'
import { ErrorBoundary } from '@/components/error-boundary'
import { setSessionProfile } from '@/lib/session-scope'

const ChatScreen = lazy(async () => {
  const module = await import('../../screens/chat/chat-screen')
  return { default: module.ChatScreen }
})

/**
 * `?profile=<name>` — the Hermes profile this chat is scoped to. Absent means
 * unscoped (legacy single-profile behaviour, byte-identical keys). It is the
 * only writer of the ambient session profile, so it must be applied before the
 * subtree renders — hence `beforeLoad` rather than an effect.
 */
const searchSchema = z.object({
  profile: z.string().trim().min(1).optional(),
})

export const Route = createFileRoute('/chat/$sessionKey')({
  component: ChatRoute,
  validateSearch: searchSchema,
  // `?profile=` survives EVERY navigation into this route, whatever the call
  // site. It is declared on the destination route rather than passed by each
  // `navigate()` because a conversation that loses its profile mid-thread keeps
  // streaming, returns 200, and silently writes the rest of itself into another
  // profile's `state.db` — a failure no caller sees. Per-call `search: (prev)
  // => prev` guarded exactly one of those call sites and was re-broken by the
  // next one added. A middleware here cannot be forgotten by a future author,
  // because there is nothing for them to remember.
  //
  // Explicit intent still wins: the middleware only fills `profile` in when the
  // navigation did not mention the key at all, so the composer's profile picker
  // clears scope by sending `profile: undefined` (present-but-empty) rather
  // than by omitting the key.
  search: { middlewares: [retainSearchParams(['profile'])] },
  beforeLoad: ({ search }) => {
    setSessionProfile(search.profile ?? null)
  },
  // Disable SSR to prevent hydration mismatches from async data
  ssr: false,
  errorComponent: function ChatError({ error, reset }) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center bg-primary-50">
        <div className="max-w-md">
          <div className="mb-4 text-5xl">💬</div>
          <h2 className="text-xl font-semibold text-primary-900 mb-3">
            Chat Error
          </h2>
          <p className="text-sm text-primary-600 mb-6">
            {error instanceof Error
              ? error.message
              : 'Failed to load chat session'}
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={reset}
              className="px-4 py-2 bg-accent-500 text-white rounded-lg hover:bg-accent-600 transition-colors"
            >
              Try Again
            </button>
            <button
              onClick={() => {
                if (typeof window !== 'undefined')
                  window.location.href = '/chat'
              }}
              className="px-4 py-2 border border-primary-300 text-primary-700 rounded-lg hover:bg-primary-100 transition-colors"
            >
              Return to Main
            </button>
          </div>
        </div>
      </div>
    )
  },
})

function ChatRoute() {
  // Client-only rendering to prevent hydration mismatches
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [forcedSession, setForcedSession] = useState<{
    friendlyId: string
    sessionKey: string
  } | null>(null)
  const params = Route.useParams()
  // Ambient profile is applied in `beforeLoad`; re-apply here so a client-side
  // `?profile=` change is in effect for the keys built during THIS render, not
  // one render later. Idempotent, and not React state — safe during render.
  setSessionProfile(Route.useSearch().profile ?? null)
  const activeFriendlyId =
    typeof params.sessionKey === 'string' ? params.sessionKey : 'main'
  const isNewChat = activeFriendlyId === 'new'
  const forcedSessionKey =
    forcedSession?.friendlyId === activeFriendlyId
      ? forcedSession.sessionKey
      : undefined

  // Clear history cache when navigating to new chat
  useEffect(() => {
    if (isNewChat) {
      queryClient.removeQueries({
        queryKey: chatQueryKeys.history('new', 'new'),
      })
    }
  }, [isNewChat, queryClient])

  const resolveSession = useCallback(
    function (payload: { friendlyId: string; sessionKey: string }) {
      const sourceFriendlyId = activeFriendlyId
      const sourceSessionKey = forcedSessionKey ?? activeFriendlyId
      moveHistoryMessages(
        queryClient,
        sourceFriendlyId,
        sourceSessionKey,
        payload.friendlyId,
        payload.sessionKey,
      )
      reconcileSessionDraft(
        queryClient,
        sourceFriendlyId,
        sourceSessionKey,
        payload.friendlyId,
        payload.sessionKey,
      )
      invalidateSessionLists(queryClient)
      setForcedSession({
        friendlyId: payload.friendlyId,
        sessionKey: payload.sessionKey,
      })
      // Persist last session for refresh recovery
      try {
        localStorage.setItem('claude-last-session', payload.friendlyId)
      } catch {}
      navigate({
        to: '/chat/$sessionKey',
        params: { sessionKey: payload.friendlyId },
        // No `search` here on purpose: the route's `retainSearchParams`
        // middleware carries `?profile=` across the new-chat → real-session
        // swap. Spelling it per-call would make the guarantee look like a
        // call-site convention, which is how it regressed before.
        replace: true,
      })
    },
    [activeFriendlyId, forcedSessionKey, navigate, queryClient],
  )

  if (!mounted) {
    return (
      <div className="flex h-full items-center justify-center text-primary-400">
        Loading chat…
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-primary-400">
            Loading chat…
          </div>
        }
      >
        <ChatScreen
          activeFriendlyId={activeFriendlyId}
          isNewChat={isNewChat}
          forcedSessionKey={forcedSessionKey}
          onSessionResolved={
            isNewChat || activeFriendlyId === 'main'
              ? resolveSession
              : undefined
          }
        />
      </Suspense>
    </ErrorBoundary>
  )
}
