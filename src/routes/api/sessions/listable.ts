import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { dashboardFetch } from '../../../server/gateway-capabilities'
import { toSessionSummary } from '../../../server/hermes-api'
import { isValidProfileName } from '../../../lib/profile-name'
import type { ClaudeSession } from '../../../server/hermes-api'
import { runPool } from '@/lib/run-pool'

export const MAX_LISTABLE_IDS = 100
/** Per detail read; the dashboard is local, so this only trips on a hang. */
const DETAIL_TIMEOUT_MS = 5_000

/** Hermes session ids (and nothing that could walk a URL path). */
export function isSessionIdShape(id: string): boolean {
  return (
    id !== '.' &&
    id !== '..' &&
    /^[A-Za-z0-9_:-][A-Za-z0-9_.:-]{0,127}$/.test(id)
  )
}

type DashboardSessionRow = ClaudeSession & {
  archived?: boolean | number
  hidden?: boolean | number
  model_config?: string | Record<string, unknown> | null
  last_activity_at?: number | null
  session_key?: string | null
}

/** Parent end reasons that make a same-key child a new conversation (hermes `_RESET_END_REASONS`). */
const RESET_END_REASONS = new Set([
  'session_reset',
  'session_switch',
  'idle',
  'daily',
  'suspended',
  'resume_pending_expired',
])

function modelConfig(row: DashboardSessionRow): Record<string, unknown> {
  const raw = row.model_config
  if (raw && typeof raw === 'object') return raw
  try {
    const parsed: unknown = JSON.parse(raw || '{}')
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/**
 * Would the dashboard list show this row under this id? Mirrors hermes'
 * `exclude_children` + archived filter (`_LISTABLE_CHILD_SQL`, delegate
 * marker): roots, plus branch and reset children; never delegate runs (incl.
 * orphaned `recovered` ones). A compressed chat is listed once, under its
 * newest segment: earlier segments (`end_reason: compression`) are out.
 * `parent` is only consulted for children without a branch/reset marker.
 */
export function isListableSession(
  row: DashboardSessionRow,
  parent?: DashboardSessionRow | null,
): boolean {
  const config = modelConfig(row)
  if (row.archived || row.hidden || config._delegate_from) return false
  if (row.end_reason === 'compression') return false
  if (!row.parent_session_id) return true
  if (config._branched_from || config._reset_from) return true
  if (!parent) return false
  // The list projects a compressed chat onto its newest segment (the tip).
  // ponytail: assumes the chain's root is listable; a delegate root's tip
  // would slip through — walk to the root if that ever shows up.
  if (parent.end_reason === 'compression') return true
  if (parent.end_reason === 'branched')
    return (row.started_at ?? 0) >= (parent.ended_at ?? Infinity)
  return (
    RESET_END_REASONS.has(parent.end_reason ?? '') &&
    Boolean(row.session_key) &&
    row.session_key === parent.session_key
  )
}

/** True when listability needs the parent row (a child with no marker). */
function needsParent(row: DashboardSessionRow): boolean {
  const config = modelConfig(row)
  return Boolean(
    row.parent_session_id && !config._branched_from && !config._reset_from,
  )
}

/**
 * GET /api/sessions/listable?profile=X&ids=a,b,…
 *
 * The listable sessions among `ids` (≤100), as sidebar list rows. Backs the
 * sidebar's per-folder "load the rest". The folder map's `listable` already
 * names the listed rows (compression tips included); the filter here is a
 * safety net for older maps without it. There is no list-by-ids endpoint, and
 * per-id detail through the gateway
 * hides what makes a row unlisted (delegate marker). Reads the dashboard's
 * session detail, four at a time; unknown/unreadable ids are skipped.
 */
export const Route = createFileRoute('/api/sessions/listable')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json(
            { ok: false, error: 'Unauthorized' },
            { status: 401 },
          )
        }
        const url = new URL(request.url)
        const profile = url.searchParams.get('profile')?.trim() || null
        if (profile && !isValidProfileName(profile)) {
          return Response.json(
            { ok: false, error: 'Invalid profile' },
            { status: 400 },
          )
        }
        const ids = [
          ...new Set(
            (url.searchParams.get('ids') ?? '')
              .split(',')
              .map((id) => id.trim())
              .filter(Boolean),
          ),
        ]
        if (ids.length > MAX_LISTABLE_IDS) {
          return Response.json(
            { ok: false, error: `At most ${MAX_LISTABLE_IDS} ids` },
            { status: 400 },
          )
        }
        if (!ids.every(isSessionIdShape)) {
          return Response.json(
            { ok: false, error: 'Invalid session id' },
            { status: 400 },
          )
        }
        const query = profile ? `?profile=${encodeURIComponent(profile)}` : ''
        /** null = no such session; throws when the dashboard could not answer. */
        const detail = async (id: string) => {
          const res = await dashboardFetch(
            `/api/sessions/${encodeURIComponent(id)}${query}`,
            { signal: AbortSignal.timeout(DETAIL_TIMEOUT_MS) },
          )
          if (res.status === 404) return null
          if (!res.ok) throw new Error(`dashboard ${res.status}`)
          return (await res.json()) as DashboardSessionRow
        }
        const results = await runPool(ids, 4, async (id) => {
          const row = await detail(id)
          if (!row) return null
          const parentId = row.parent_session_id
          const parent =
            needsParent(row) && parentId && isSessionIdShape(parentId)
              ? await detail(parentId)
              : null
          if (!isListableSession(row, parent)) return null
          return {
            ...toSessionSummary({
              ...row,
              last_active: row.last_active ?? row.last_activity_at,
            }),
            ...(profile ? { profile } : {}),
          }
        })
        if (ids.length > 0 && results.every((r) => r.status === 'rejected')) {
          return Response.json(
            { ok: false, error: 'Dashboard unavailable' },
            { status: 503 },
          )
        }
        return Response.json({
          ok: true,
          sessions: results.flatMap((r) =>
            r.status === 'fulfilled' && r.value ? [r.value] : [],
          ),
        })
      },
    },
  },
})
