import { createFileRoute } from '@tanstack/react-router'
import {
  SESSIONS_API_UNAVAILABLE_MESSAGE,
  ensureGatewayProbed,
  getGatewayCapabilities,
  getMessages,
  listSessions,
  toChatMessage,
} from '../../server/hermes-api'
import { resolveSessionKey } from '../../server/session-utils'
import { isAuthenticated } from '@/server/auth-middleware'
import { getLocalSession, getLocalMessages } from '../../server/local-session-store'

// Short-TTL cache for the resolved "main" session id. Rapid history refetches
// (mount + window-focus + interval) otherwise each fire a listSessions(30,0)
// just to re-derive the same id. 15s is short enough that a newly-created
// real session still becomes "main" promptly. (#215)
const MAIN_RESOLUTION_TTL_MS = 15_000
let _mainResolutionCache: { id: string | null; expiresAt: number } | null = null

/**
 * Resolve the synthetic "main" session key to the user's real main chat
 * session id, or null when there is no suitable session (caller should treat
 * as a fresh "new" chat).
 *
 * Preference order:
 *   1. Most recent non-internal session with a real human-set title.
 *   2. Most recent non-internal session that has messages.
 *
 * Cron + Operations per-agent sessions are skipped so the orchestrator chat
 * doesn't latch onto runtime junk.
 *
 * NOTE: this still calls listSessions(30,0) on a cache miss. True gateway-side
 * pagination/limit for the message fetch is tracked in #215 (gateway change,
 * out of scope here).
 */
export async function resolveMainSessionId(): Promise<string | null> {
  const now = Date.now()
  if (_mainResolutionCache && _mainResolutionCache.expiresAt > now) {
    return _mainResolutionCache.id
  }
  const sessions = await listSessions(30, 0)
  const isInternalKey = (id: string) =>
    id.startsWith('cron_') ||
    id.startsWith('cron:') ||
    id.startsWith('agent:main:ops-')
  const hasRealTitle = (s: { id: string; title?: string | null }) => {
    const t = (s.title ?? '').trim()
    return t.length > 0 && t !== s.id
  }
  const titled = sessions.find((s) => !isInternalKey(s.id) && hasRealTitle(s))
  const fallback = titled
    ? null
    : sessions.find(
        (s) =>
          !isInternalKey(s.id) &&
          typeof s.message_count === 'number' &&
          s.message_count > 0,
      )
  const candidate = titled ?? fallback
  const resolvedId = candidate ? candidate.id : null
  _mainResolutionCache = { id: resolvedId, expiresAt: now + MAIN_RESOLUTION_TTL_MS }
  return resolvedId
}

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
          const limit = Number(url.searchParams.get('limit') || '200')
          const rawSessionKey = url.searchParams.get('sessionKey')?.trim()
          const friendlyId = url.searchParams.get('friendlyId')?.trim()
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
            try {
              const resolvedId = await resolveMainSessionId()
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
            messages = await getMessages(sessionKey)
          } catch (err) {
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

          // The gateway message endpoints (getMessages / dashboard
          // getSessionMessages) accept no limit/offset param, so we fetch the
          // full transcript and slice client-side here. True server-side
          // pagination requires a hermes-agent change — tracked in #215.
          const boundedMessages = limit > 0 ? messages.slice(-limit) : messages

          return Response.json({
            sessionKey,
            sessionId: sessionKey,
            messages: boundedMessages.map((message, index) =>
              toChatMessage(message, { historyIndex: index }),
            ),
          })
        } catch (err) {
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
