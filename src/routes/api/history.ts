import { createFileRoute } from '@tanstack/react-router'
import {
  SESSIONS_API_UNAVAILABLE_MESSAGE,
  ensureGatewayProbed,
  getGatewayCapabilities,
  getMessages,
  listSessions,
  toChatMessage,
} from '../../server/hermes-api'
import {
  getLocalMessages,
  getLocalSession,
} from '../../server/local-session-store'
import { resolveMainSessionId } from '../../server/main-session-resolver'
import { resolveSessionKey } from '../../server/session-utils'
import {
  isProfileScopeError,
  profileErrorStatus,
  readProfile,
} from '../../server/profile-scope'
import { isAuthenticated } from '@/server/auth-middleware'

const DEFAULT_HISTORY_LIMIT = 150

export const Route = createFileRoute('/api/history')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        await ensureGatewayProbed()
        if (!getGatewayCapabilities().sessions) {
          return Response.json({
            sessionKey: 'new',
            sessionId: 'new',
            messages: [],
            source: 'unavailable',
            message: SESSIONS_API_UNAVAILABLE_MESSAGE,
          })
        }
        try {
          const url = new URL(request.url)
          const limit = Number(url.searchParams.get('limit') || String(DEFAULT_HISTORY_LIMIT))
          const rawSessionKey = url.searchParams.get('sessionKey')?.trim()
          const friendlyId = url.searchParams.get('friendlyId')?.trim()
          const profile = readProfile(url.searchParams.get('profile'))
          let { sessionKey } = await resolveSessionKey({
            rawSessionKey,
            friendlyId,
            defaultKey: 'main',
          })
          // Keep /chat/new empty until the first message creates a real session.
          if (sessionKey === 'new') {
            return Response.json({
              sessionKey: 'new',
              sessionId: 'new',
              messages: [],
            })
          }
          // "main" doesn't exist in Claude — resolve it to the user's real
          // main chat session. We prefer (in order):
          //   1. The most recent session with a real human-set title
          //      (label !== id, e.g. "hows everything"). This is what users
          //      actually mean by "main".
          //   2. The most recent non-internal session with messages.
          // Cron + Operations per-agent sessions are skipped so the
          // orchestrator chat doesn't latch onto runtime junk.
          if (sessionKey === 'main') {
            // `listSessions()` is unscoped, i.e. the active profile. Picking a
            // "main" out of it under an explicit profile would latch onto a
            // foreign session, so a scoped "main" simply presents as a fresh
            // chat. Mirrors send-stream's identical guard.
            if (profile) {
              return Response.json({
                sessionKey: 'new',
                sessionId: 'new',
                messages: [],
              })
            }
            try {
              const resolvedId = await resolveMainSessionId({ listSessions })
              if (resolvedId) {
                sessionKey = resolvedId
              } else {
                return Response.json({
                  sessionKey: 'new',
                  sessionId: 'new',
                  messages: [],
                })
              }
            } catch {
              // Resolution failure stays soft: an unresolvable "main" simply
              // presents as a fresh chat rather than an error (#217). The
              // messages-fetch failure below is the one that must surface 503.
              return Response.json({ sessionKey: 'new', sessionId: 'new', messages: [] })
            }
          }
          let messages: Awaited<ReturnType<typeof getMessages>> = []
          try {
            messages = await getMessages(
              sessionKey,
              { limit: limit > 0 ? limit : undefined, offset: 0 },
              profile,
            )
          } catch (err) {
            if (isProfileScopeError(err)) {
              return Response.json(
                {
                  error: (err as Error).message,
                  profile,
                },
                { status: profileErrorStatus(err) },
              )
            }
            // A gateway failure here previously collapsed into an empty
            // transcript, making a real outage indistinguishable from an
            // empty session and wiping the rendered chat (#217). Surface a
            // 503 instead so the client throws and KEEPS its cached history
            // (TanStack Query retains previous data on query error).
            const detail = err instanceof Error ? err.message : String(err)
            return Response.json(
              {
                error: `Failed to load session messages: ${detail}`,
                degraded: true,
                sessionKey,
                sessionId: sessionKey,
              },
              { status: 503 },
            )
          }

          // Fallback to local session store for portable/local model sessions
          if (messages.length === 0) {
            const localSession = getLocalSession(sessionKey)
            if (localSession) {
              const localMessages = getLocalMessages(sessionKey)
              return Response.json({
                sessionKey,
                sessionId: sessionKey,
                messages: localMessages.map((m, index) => ({
                  id: m.id,
                  role: m.role,
                  content: [{ type: 'text', text: m.content }],
                  timestamp: m.timestamp,
                  historyIndex: index,
                })),
              })
            }
          }

          // Keep a client-side tail bound as a safety net for older gateways
          // that ignore limit/offset. Newer gateways can trim at source.
          const boundedMessages = limit > 0 ? messages.slice(-limit) : messages

          return Response.json({
            sessionKey,
            sessionId: sessionKey,
            messages: boundedMessages.map((message, index) =>
              toChatMessage(message, { historyIndex: index }),
            ),
          })
        } catch (err) {
          if (isProfileScopeError(err)) {
            return Response.json(
              {
                error: (err as Error).message,
              },
              { status: profileErrorStatus(err) },
            )
          }
          return Response.json(
            {
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
