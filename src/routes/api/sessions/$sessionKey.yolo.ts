/**
 * `GET|POST /api/sessions/:sessionKey/yolo` — per-session approval bypass.
 *
 * Thin proxy over the gateway's `/api/sessions/{session_id}/yolo` (hermes-agent
 * ≥ 0.19.13, `gateway/platforms/api_server.py`).
 *
 * Why this is an endpoint and not a slash command. `tools/approval.py`'s
 * `_session_yolo` is a module-level `set[str]` with no persistence and no IPC,
 * so the bypass only exists in the process that enforces it. SwitchUI's chats
 * are served by the GATEWAY process, while `/yolo` over `slash.exec` ran first
 * in a slash-worker subprocess and later in the dashboard — both of which flip
 * a set the enforcing agent never reads. It reported a state change nothing
 * enforced (hermes-agent#219). The gateway endpoint is the only surface that
 * toggles the set the approval guard actually consults, so it is the only
 * authority this UI talks to. `/yolo` stays refused as a slash command.
 *
 * Session keying. The gateway keys the bypass on `_yolo_session_key()` =
 * `gateway_session_key or session_id` — the value of `X-Hermes-Session-Key`
 * when sent, else the `{session_id}` from the URL. That is the SAME expression
 * `_run_agent` binds to `HERMES_SESSION_KEY` and registers approvals under, and
 * the same one the per-request model override uses. Verified live: enabling
 * with `X-Hermes-Session-Key: sk-test-1` and reading back without the header
 * returns `false` — a mismatched key toggles a bypass nothing reads. So the key
 * is derived through the one shared helper every chat transport uses,
 * `resolveSessionKeyValue()`, and never recomputed with an ad-hoc `||`.
 *
 * State is PROCESS-RESIDENT and deliberately not persisted: a gateway restart
 * clears it silently. Nothing here caches it — every read goes to the gateway,
 * and the client query refetches on mount/focus/reconnect plus a slow poll so
 * the UI cannot show a stale "on". See `use-session-yolo.ts`.
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import {
  SESSIONS_API_UNAVAILABLE_MESSAGE,
  ensureGatewayProbed,
  getGatewayCapabilities,
} from '../../../server/hermes-api'
import { gatewayFetch } from '../../../server/gateway-capabilities'
import {
  assertProfileResponseOk,
  assertProfileServed,
  isProfileScopeError,
  profileErrorStatus,
  readProfile,
  scopedPath,
} from '../../../server/profile-scope'
import {
  HERMES_SESSION_KEY_HEADER,
  resolveSessionKeyValue,
} from '@/lib/send-stream-session-headers'

const GATEWAY_TIMEOUT_MS = 10_000

/** A gateway build older than 0.19.13 has no such route. Not an error worth
 *  showing anybody — it means "this build has no per-session bypass". */
const UNSUPPORTED_MESSAGE =
  'This gateway build has no per-session approval bypass (requires hermes-agent 0.19.13).'

type YoloWire = {
  enabled?: unknown
  previous?: unknown
  error?: unknown
}

function unauthorized(): Response {
  return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}

/**
 * The value the gateway will key the bypass on.
 *
 * `stableSessionKey` mirrors `send-stream.ts`'s `headerSessionKey`: a caller
 * that already holds a distinct stable key forwards it under the same header.
 * The browser sends none — the chat screen passes its canonical session key as
 * the path param instead — so in practice this resolves to `sessionKey`.
 */
function yoloSessionKey(request: Request, sessionKey: string): string {
  return resolveSessionKeyValue({
    stableSessionKey: request.headers.get(HERMES_SESSION_KEY_HEADER),
    sessionId: sessionKey,
  })
}

function readEnabled(json: YoloWire): boolean {
  return json.enabled === true
}

function errorMessage(json: YoloWire, fallback: string): string {
  const error = json.error
  if (typeof error === 'string' && error.trim()) return error.trim()
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message
    if (typeof message === 'string' && message.trim()) return message.trim()
  }
  return fallback
}

export const Route = createFileRoute('/api/sessions/$sessionKey/yolo')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) return unauthorized()

        await ensureGatewayProbed()
        if (!getGatewayCapabilities().sessions) {
          return Response.json(
            { ok: false, error: SESSIONS_API_UNAVAILABLE_MESSAGE },
            { status: 503 },
          )
        }

        const sessionKey = params.sessionKey.trim()
        if (!sessionKey) {
          return Response.json(
            { ok: false, error: 'sessionKey required' },
            { status: 400 },
          )
        }

        const url = new URL(request.url)
        const profile = readProfile(url.searchParams.get('profile'))
        try {
          if (profile) await assertProfileServed(profile)
        } catch (err) {
          if (!isProfileScopeError(err)) throw err
          return Response.json(
            { ok: false, error: (err as Error).message },
            { status: profileErrorStatus(err) },
          )
        }

        try {
          const res = await gatewayFetch(
            await scopedPath(`/api/sessions/${sessionKey}/yolo`, profile),
            {
              headers: {
                [HERMES_SESSION_KEY_HEADER]: yoloSessionKey(
                  request,
                  sessionKey,
                ),
              },
              signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
            },
          )
          // A 404 on a request we PREFIXED means the prefix was rejected, not
          // that the route is missing — that is a typed profile refusal and
          // must never degrade to "unsupported".
          await assertProfileResponseOk(res, profile)

          if (res.status === 404) {
            return Response.json(
              { ok: true, enabled: false, unsupported: true },
              { status: 200 },
            )
          }

          const json = (await res.json().catch(() => ({}))) as YoloWire
          if (!res.ok) {
            return Response.json(
              {
                ok: false,
                error: errorMessage(json, 'Failed to read approval bypass'),
              },
              { status: res.status },
            )
          }
          return Response.json({ ok: true, enabled: readEnabled(json) })
        } catch (err) {
          if (isProfileScopeError(err)) {
            return Response.json(
              { ok: false, error: (err as Error).message },
              { status: profileErrorStatus(err) },
            )
          }
          return Response.json(
            {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
          )
        }
      },

      POST: async ({ request, params }) => {
        if (!isAuthenticated(request)) return unauthorized()
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        await ensureGatewayProbed()
        if (!getGatewayCapabilities().sessions) {
          return Response.json(
            { ok: false, error: SESSIONS_API_UNAVAILABLE_MESSAGE },
            { status: 503 },
          )
        }

        const sessionKey = params.sessionKey.trim()
        if (!sessionKey) {
          return Response.json(
            { ok: false, error: 'sessionKey required' },
            { status: 400 },
          )
        }

        let body: Record<string, unknown>
        try {
          body = (await request.json()) as Record<string, unknown>
        } catch {
          return Response.json(
            { ok: false, error: 'Invalid JSON body' },
            { status: 400 },
          )
        }

        // Validate at OUR edge rather than letting the gateway do it. The
        // gateway also accepts "on"/"off"/"1"/"0" strings; narrowing to a
        // boolean here means a typo in a caller can never be coerced into
        // silently ENABLING a bypass. Same 400 the gateway returns, same
        // guarantee: state unchanged.
        const raw = body.enabled
        const toggle = raw === undefined || raw === null
        if (!toggle && typeof raw !== 'boolean') {
          return Response.json(
            {
              ok: false,
              error: 'enabled must be a boolean (omit it to toggle)',
            },
            { status: 400 },
          )
        }

        const profile = readProfile(body.profile)
        try {
          if (profile) await assertProfileServed(profile)
        } catch (err) {
          if (!isProfileScopeError(err)) throw err
          return Response.json(
            { ok: false, error: (err as Error).message },
            { status: profileErrorStatus(err) },
          )
        }

        try {
          const res = await gatewayFetch(
            await scopedPath(`/api/sessions/${sessionKey}/yolo`, profile),
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                [HERMES_SESSION_KEY_HEADER]: yoloSessionKey(
                  request,
                  sessionKey,
                ),
              },
              // Omitting `enabled` is the gateway's toggle. The UI always
              // sends an explicit value — a toggle would race a state it read
              // seconds ago — but the pass-through keeps the shapes identical.
              body: JSON.stringify(toggle ? {} : { enabled: raw }),
              signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
            },
          )
          await assertProfileResponseOk(res, profile)

          if (res.status === 404) {
            return Response.json(
              { ok: false, error: UNSUPPORTED_MESSAGE, unsupported: true },
              { status: 501 },
            )
          }

          const json = (await res.json().catch(() => ({}))) as YoloWire
          if (!res.ok) {
            return Response.json(
              {
                ok: false,
                error: errorMessage(json, 'Failed to set approval bypass'),
              },
              { status: res.status },
            )
          }

          return Response.json({
            ok: true,
            enabled: readEnabled(json),
            previous: json.previous === true,
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
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
