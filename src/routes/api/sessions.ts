import { randomUUID } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { requireJsonContentType } from '../../server/rate-limit'
import {
  assertProfileServed,
  isProfileScopeError,
  profileErrorStatus,
  readProfile,
} from '../../server/profile-scope'
import { listProfileSessions } from '../../server/claude-dashboard-api'
import {
  SESSIONS_API_UNAVAILABLE_MESSAGE,
  createSession,
  deleteSession,
  ensureGatewayProbed,
  getSession,
  listSessions,
  searchSessions,
  toSessionSummary,
  updateSession,
} from '../../server/hermes-api'
import {
  deleteLocalSession,
  getLocalSession,
  listLocalSessions,
  updateLocalSessionTitle,
} from '../../server/local-session-store'
import type { ClaudeSession } from '../../server/hermes-api'
import { createCapabilityUnavailablePayload } from '@/lib/feature-gates'

async function listAllSessions(pageSize = 1000) {
  const sessions = [] as Array<Awaited<ReturnType<typeof listSessions>>[number]>
  for (let offset = 0; ; offset += pageSize) {
    const page = await listSessions(pageSize, offset)
    sessions.push(...page)
    if (page.length < pageSize) break
  }
  return sessions
}

function toLocalSessionSummary(
  session: ReturnType<typeof listLocalSessions>[number],
) {
  return {
    key: session.id,
    id: session.id,
    friendlyId: session.id,
    title: session.title || 'Local Chat',
    label: session.title || 'Local Chat',
    derivedTitle: session.title || 'Local Chat',
    startedAt: session.createdAt,
    updatedAt: session.updatedAt,
    message_count: session.messageCount,
    model: session.model,
    source: 'local',
  }
}

export const Route = createFileRoute('/api/sessions')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Auth check
        if (!isAuthenticated(request)) {
          return Response.json(
            { ok: false, error: 'Unauthorized' },
            { status: 401 },
          )
        }
        const capabilities = await ensureGatewayProbed()
        if (!capabilities.sessions) {
          return Response.json({
            ok: true,
            sessions: [],
            source: 'unavailable',
            message: SESSIONS_API_UNAVAILABLE_MESSAGE,
          })
        }

        try {
          const url = new URL(request.url)

          // Cross-profile browse (P2). An explicit `?profile=` read goes
          // through the dashboard's aggregation endpoint, never the unscoped
          // active-profile listing below — that fallback is the silent
          // wrong-profile hazard. `errors[]` is passed through verbatim: a
          // profile whose `state.db` schema has drifted must render as
          // DEGRADED, never as a `0` that claims it is empty.
          const requestedProfile = readProfile(url.searchParams.get('profile'))
          const searchQuery = url.searchParams.get('q')?.trim()

          // Search is checked BEFORE the profile browse below: `?profile=X&q=`
          // used to fall into the browse branch and silently drop `q`,
          // answering a search with an unfiltered listing.
          if (searchQuery) {
            if (requestedProfile) {
              try {
                await assertProfileServed(requestedProfile)
              } catch (err) {
                if (!isProfileScopeError(err)) throw err
                return Response.json(
                  { ok: false, error: (err as Error).message },
                  { status: profileErrorStatus(err) },
                )
              }
            }
            const searchResult = await searchSessions(
              searchQuery,
              20,
              requestedProfile || undefined,
            )
            const resultRows = Array.isArray(searchResult.results)
              ? searchResult.results
              : []
            const snippetBySessionId = new Map<string, string>()
            const sessionIds = [
              ...new Set(
                resultRows
                  .map((result) => {
                    if (!result || typeof result !== 'object') return ''
                    const record = result as Record<string, unknown>
                    const sessionId =
                      typeof record.session_id === 'string'
                        ? record.session_id
                        : ''
                    if (
                      sessionId &&
                      typeof record.snippet === 'string' &&
                      !snippetBySessionId.has(sessionId)
                    ) {
                      snippetBySessionId.set(sessionId, record.snippet)
                    }
                    return sessionId
                  })
                  .filter(Boolean),
              ),
            ]
            // Hydration is scoped too: an unscoped getSession() would resolve
            // these IDs against the gateway's own profile, and IDs are not
            // unique across profiles.
            const sessions = (
              await Promise.all(
                sessionIds.map((sessionId) =>
                  getSession(sessionId, requestedProfile || undefined).catch(
                    () => null,
                  ),
                ),
              )
            ).filter((session) => session !== null)
            return Response.json({
              sessions: sessions.map((session) => ({
                ...toSessionSummary(session),
                preview: snippetBySessionId.get(session.id),
              })),
            })
          }

          const requestedSessionKey = url.searchParams.get('sessionKey')?.trim()
          if (requestedSessionKey) {
            if (requestedSessionKey === 'new') {
              return Response.json({
                ok: true,
                sessions: [],
              })
            }
            const localSession = getLocalSession(requestedSessionKey)
            if (localSession) {
              return Response.json({
                sessions: [toLocalSessionSummary(localSession)],
              })
            }
            try {
              const session = requestedProfile
                ? await getSession(requestedSessionKey, requestedProfile)
                : await getSession(requestedSessionKey)
              return Response.json({
                sessions: [
                  {
                    ...toSessionSummary(session),
                    ...(requestedProfile ? { profile: requestedProfile } : {}),
                  },
                ],
              })
            } catch (err) {
              if (isProfileScopeError(err)) {
                return Response.json(
                  { ok: false, error: (err as Error).message },
                  { status: profileErrorStatus(err) },
                )
              }
              throw err
            }
          }

          if (requestedProfile) {
            const profileLimit = Number(url.searchParams.get('limit'))
            const profileOffset = Number(url.searchParams.get('offset'))
            const result = await listProfileSessions(
              requestedProfile,
              Number.isFinite(profileLimit) && profileLimit > 0
                ? Math.min(profileLimit, 1000)
                : 50,
              Number.isFinite(profileOffset) && profileOffset > 0
                ? profileOffset
                : 0,
            )
            return Response.json({
              ok: true,
              sessions: result.sessions.map((row) => {
                // Only `source` differs between the dashboard row and
                // ClaudeSession (`string | null` vs `string`); normalizing it
                // avoids a cast that `no-unnecessary-type-assertion` could eat.
                const session: ClaudeSession = {
                  ...row,
                  source: row.source ?? undefined,
                }
                return {
                  ...toSessionSummary(session),
                  profile: row.profile ?? row.profile_name ?? requestedProfile,
                }
              }),
              total: result.total,
              profile_totals: result.profile_totals,
              errors: result.errors ?? [],
            })
          }

          const requestedLimit = Number(url.searchParams.get('limit'))
          const requestedOffset = Number(url.searchParams.get('offset'))
          const hasPagination =
            Number.isFinite(requestedLimit) && requestedLimit > 0
          const limit = hasPagination ? Math.min(requestedLimit, 1000) : 1000
          const offset =
            Number.isFinite(requestedOffset) && requestedOffset > 0
              ? requestedOffset
              : 0
          const localSessions = listLocalSessions()
          const gatewayOffset = hasPagination
            ? Math.max(0, offset - localSessions.length)
            : 0
          const sessions = hasPagination
            ? await listSessions(limit + localSessions.length, gatewayOffset)
            : await listAllSessions(limit)
          const gatewaySessions = sessions.map(toSessionSummary)

          // Merge local portable sessions (Ollama, Atomic Chat, etc.)
          const gatewayIds = new Set(
            gatewaySessions.map((s: any) => s.key || s.id),
          )
          for (const ls of localSessions) {
            if (!gatewayIds.has(ls.id)) {
              gatewaySessions.push(toLocalSessionSummary(ls))
            }
          }

          if (!hasPagination) {
            return Response.json({ sessions: gatewaySessions })
          }
          gatewaySessions.sort(
            (a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0),
          )
          const pageStart = offset - gatewayOffset
          return Response.json({
            sessions: gatewaySessions.slice(pageStart, pageStart + limit),
          })
        } catch (err) {
          if (isProfileScopeError(err)) {
            return Response.json(
              { ok: false, error: (err as Error).message },
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
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json(
            { ok: false, error: 'Unauthorized' },
            { status: 401 },
          )
        }
        const csrfCheckPost = requireJsonContentType(request)
        if (csrfCheckPost) return csrfCheckPost
        const capabilities = await ensureGatewayProbed()
        if (!capabilities.sessions) {
          const friendlyId = randomUUID()
          return Response.json({
            ...createCapabilityUnavailablePayload('sessions'),
            ok: true,
            sessionKey: friendlyId,
            friendlyId,
            persisted: false,
          })
        }
        try {
          const body = (await request.json().catch(() => ({}))) as Record<
            string,
            unknown
          >

          const requestedLabel =
            typeof body.label === 'string' ? body.label.trim() : ''
          const label = requestedLabel || undefined

          const requestedFriendlyId =
            typeof body.friendlyId === 'string' ? body.friendlyId.trim() : ''
          const friendlyId = requestedFriendlyId || randomUUID()

          const requestedModel =
            typeof body.model === 'string' ? body.model.trim() : ''
          const model = requestedModel || undefined

          // Fail closed before anything is created. Same ordering as
          // PATCH/DELETE below and send-stream.ts:320 — a create that cannot
          // prove its profile is routable must not reach the gateway, because
          // a `/p/` prefix on a non-multiplexing gateway returns 200 while
          // landing in the active profile's state.db.
          const profile = readProfile(body.profile)
          if (profile) {
            try {
              await assertProfileServed(profile)
            } catch (err) {
              if (!isProfileScopeError(err)) throw err
              return Response.json(
                { ok: false, error: (err as Error).message },
                { status: profileErrorStatus(err) },
              )
            }
          }

          // The dashboard shortcut is unscoped — taking it for an explicit
          // profile would silently drop the scope.
          if (
            !profile &&
            capabilities.dashboard.available &&
            !capabilities.enhancedChat
          ) {
            return Response.json({
              ok: true,
              sessionKey: friendlyId,
              friendlyId,
              entry: {
                key: friendlyId,
                id: friendlyId,
                title: label || friendlyId,
                label: label || friendlyId,
                derivedTitle: label || friendlyId,
                model: model || '',
                startedAt: Date.now(),
                updatedAt: Date.now(),
                message_count: 0,
                source: 'dashboard',
              },
              modelApplied: Boolean(model),
              persisted: false,
            })
          }

          const session = await createSession(
            {
              id: friendlyId || randomUUID(),
              title: label,
              model,
            },
            profile,
          )

          return Response.json({
            ok: true,
            sessionKey: session.id,
            friendlyId: session.id,
            entry: toSessionSummary(session),
            modelApplied: true,
          })
        } catch (err) {
          return Response.json(
            {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
          )
        }
      },
      PATCH: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json(
            { ok: false, error: 'Unauthorized' },
            { status: 401 },
          )
        }
        const csrfCheckPatch = requireJsonContentType(request)
        if (csrfCheckPatch) return csrfCheckPatch
        const capabilities = await ensureGatewayProbed()
        if (!capabilities.sessions) {
          const body = (await request.json().catch(() => ({}))) as Record<
            string,
            unknown
          >
          const rawSessionKey =
            typeof body.sessionKey === 'string' ? body.sessionKey.trim() : ''
          const rawFriendlyId =
            typeof body.friendlyId === 'string' ? body.friendlyId.trim() : ''
          const sessionKey = rawSessionKey || rawFriendlyId || randomUUID()

          return Response.json({
            ...createCapabilityUnavailablePayload('sessions'),
            ok: true,
            sessionKey,
            friendlyId: rawFriendlyId || sessionKey,
            updated: false,
          })
        }
        try {
          const body = (await request.json().catch(() => ({}))) as Record<
            string,
            unknown
          >

          const rawSessionKey =
            typeof body.sessionKey === 'string' ? body.sessionKey.trim() : ''
          const rawFriendlyId =
            typeof body.friendlyId === 'string' ? body.friendlyId.trim() : ''
          const label =
            typeof body.label === 'string' ? body.label.trim() : undefined
          const sessionKey = rawSessionKey || rawFriendlyId

          if (!sessionKey) {
            return Response.json(
              { ok: false, error: 'sessionKey required' },
              { status: 400 },
            )
          }

          // Fail closed before any mutation — local or gateway. A rename that
          // cannot prove its profile is routable must not touch either store
          // (mirrors the create-path guard above and send-stream.ts:320).
          const profile = readProfile(body.profile)
          if (profile) {
            try {
              await assertProfileServed(profile)
            } catch (err) {
              if (!isProfileScopeError(err)) throw err
              return Response.json(
                { ok: false, error: (err as Error).message },
                { status: profileErrorStatus(err) },
              )
            }
          }

          const localSession = getLocalSession(sessionKey)
          if (localSession) {
            if (label) updateLocalSessionTitle(sessionKey, label)
            return Response.json({
              ok: true,
              sessionKey,
              friendlyId: rawFriendlyId || sessionKey,
              entry: {
                key: sessionKey,
                id: sessionKey,
                title: label || sessionKey,
                label: label || sessionKey,
                derivedTitle: label || sessionKey,
                startedAt: localSession.createdAt,
                updatedAt: Date.now(),
                message_count: localSession.messageCount,
                model: localSession.model,
                source: 'local',
              },
              updated: true,
              source: 'local',
            })
          }

          if (
            !profile &&
            capabilities.dashboard.available &&
            !capabilities.enhancedChat
          ) {
            return Response.json({
              ok: true,
              sessionKey,
              entry: {
                key: sessionKey,
                id: sessionKey,
                title: label || sessionKey,
                label: label || sessionKey,
                derivedTitle: label || sessionKey,
                updatedAt: Date.now(),
              },
              updated: false,
            })
          }

          const session = await updateSession(
            sessionKey,
            { title: label },
            profile,
          )

          return Response.json({
            ok: true,
            sessionKey,
            entry: toSessionSummary(session),
          })
        } catch (err) {
          return Response.json(
            {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
          )
        }
      },
      DELETE: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json(
            { ok: false, error: 'Unauthorized' },
            { status: 401 },
          )
        }
        const url = new URL(request.url)
        const rawSessionKey = url.searchParams.get('sessionKey') ?? ''
        const rawFriendlyId = url.searchParams.get('friendlyId') ?? ''
        const sessionKey = rawSessionKey.trim() || rawFriendlyId.trim()

        if (!sessionKey) {
          return Response.json(
            { ok: false, error: 'sessionKey required' },
            { status: 400 },
          )
        }

        // Optional JSON body carries the scoped profile. Tolerant of a
        // missing/empty body so existing unscoped callers (no body at all)
        // are unaffected.
        const body = (await request.json().catch(() => ({}))) as Record<
          string,
          unknown
        >

        // Fail closed before any mutation — local or gateway. A delete that
        // cannot prove its profile is routable must not touch either store:
        // deleting a colliding session ID in the wrong profile's state.db
        // is unrecoverable (mirrors PATCH above and send-stream.ts:320).
        const profile = readProfile(body.profile)
        if (profile) {
          try {
            await assertProfileServed(profile)
          } catch (err) {
            if (!isProfileScopeError(err)) throw err
            return Response.json(
              { ok: false, error: (err as Error).message },
              { status: profileErrorStatus(err) },
            )
          }
        }

        // Local sessions live in the workspace portable store, not the
        // gateway. Delete them locally without hitting the gateway.
        if (getLocalSession(sessionKey)) {
          deleteLocalSession(sessionKey)
          return Response.json({ ok: true, sessionKey, source: 'local' })
        }

        const capabilities = await ensureGatewayProbed()
        if (!capabilities.sessions) {
          return Response.json({
            ...createCapabilityUnavailablePayload('sessions'),
            ok: true,
            sessionKey,
            deleted: false,
          })
        }
        try {
          await deleteSession(sessionKey, profile)

          return Response.json({ ok: true, sessionKey })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          // 404 from gateway means session already gone — treat as success
          if (msg.includes(': 404')) {
            return Response.json({ ok: true, sessionKey, alreadyDeleted: true })
          }
          return Response.json({ ok: false, error: msg }, { status: 500 })
        }
      },
    },
  },
})
