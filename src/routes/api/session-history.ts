/**
 * ControlSuite-compatible session-history adapter.
 * Forwards to the existing /api/history handler with param translation:
 *   key= -> sessionKey=
 *   limit, includeTools pass through.
 */
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
import { readProfile } from '../../server/profile-scope'
import { isAuthenticated } from '@/server/auth-middleware'

export const Route = createFileRoute('/api/session-history')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        await ensureGatewayProbed()
        const url = new URL(request.url)
        const key =
          url.searchParams.get('key')?.trim() ||
          url.searchParams.get('sessionKey')?.trim() ||
          ''
        const limit = Number(url.searchParams.get('limit') || '200')
        const includeTools = url.searchParams.get('includeTools') === 'true'
        // Same-ID sessions exist in every profile; an unscoped read here hands
        // back the active profile's transcript under the scoped chat's id.
        const profile = readProfile(url.searchParams.get('profile'))
        if (!key) {
          return Response.json({ ok: false, messages: [], error: 'key is required' })
        }
        // Try local store first (in-memory sessions)
        const local = getLocalSession(key)
        if (local) {
          const messages = getLocalMessages(key).slice(-limit)
          return Response.json({ ok: true, messages, sessionKey: key, source: 'local' })
        }
        if (!getGatewayCapabilities().sessions) {
          return Response.json({
            ok: false,
            messages: [],
            sessionKey: key,
            error: SESSIONS_API_UNAVAILABLE_MESSAGE,
          })
        }
        try {
          const resolved = await resolveSessionKey({
            rawSessionKey: key,
            defaultKey: 'main',
          })
          void includeTools
          // `listSessions()` is unscoped (active profile), so a scoped "main"
          // would resolve to a foreign session — present it as empty instead.
          const effectiveSessionKey =
            resolved.sessionKey === 'main'
              ? profile
                ? null
                : await resolveMainSessionId({ listSessions })
              : resolved.sessionKey
          if (!effectiveSessionKey) {
            return Response.json({
              ok: true,
              messages: [],
              sessionKey: 'new',
              source: 'gateway',
            })
          }
          const rows = await getMessages(
            effectiveSessionKey,
            { limit: limit > 0 ? limit : undefined, offset: 0 },
            profile,
          )
          const trimmed = rows.slice(-limit)
          return Response.json({
            ok: true,
            messages: trimmed.map((row) => toChatMessage(row)),
            sessionKey: effectiveSessionKey,
            source: 'gateway',
          })
        } catch (error) {
          return Response.json(
            {
              ok: false,
              messages: [],
              sessionKey: key,
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to load history',
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
