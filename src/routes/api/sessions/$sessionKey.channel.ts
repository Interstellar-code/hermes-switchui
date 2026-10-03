/**
 * `GET|POST /api/sessions/:sessionKey/channel` — hand a session off to a
 * messaging channel (Telegram topic etc.) of the session's profile.
 *
 * No gateway REST endpoint arms a handoff, so this writes the profile's
 * `state.db` directly with the exact UPDATE hermes-agent's
 * `request_handoff_status` (hermes_state_gateway.py) runs. The gateway's
 * `_handoff_watcher` polls that column every 2s, creates the topic, and
 * re-binds the session (`record_gateway_session_peer` rewrites
 * source/chat_id/thread_id on the row — which is what GET reports back).
 *
 * The URL `sessionKey` is the gateway session id (`toSessionSummary` → key =
 * session.id), i.e. `sessions.id` in state.db.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import { dashboardFetch } from '../../../server/gateway-capabilities'
import { getGatewayMode, readProfile } from '../../../server/profile-scope'
import { getActiveProfileName } from '../../../server/profiles-browser'
import {
  getHermesRoot,
  getProfileHermesHome,
} from '../../../server/claude-paths'
import { getActiveRunForSession } from '../../../server/run-store'
import { scopeKey } from '@/lib/session-scope'
import { isValidProfileName } from '@/lib/profile-name'

/** Platforms whose adapter implements `create_handoff_thread`. */
const HANDOFF_PLATFORMS = new Set(['telegram', 'discord', 'slack'])

type ChannelRow = {
  id: string
  source: string | null
  chat_id: string | null
  thread_id: string | null
  title: string | null
  handoff_state: string | null
  handoff_platform: string | null
  handoff_error: string | null
  handoff_requested_at: number | null
}

export type ChannelPlatform = {
  id: string
  name: string
  state: string
  homeChannel: {
    platform: string
    chat_id?: string
    thread_id?: string
    name?: string
  } | null
  /** null = actionable; otherwise why handoff is unavailable. */
  unavailableReason: string | null
}

/** An existing topic a session can continue in (`handoff_target`). */
export type ChannelTarget = {
  target: string
  platform: string
  chatId: string
  threadId: string
  label: string
  /** Epoch seconds of the newest session seen in that topic. */
  lastActive: number | null
}

type RawDirEntry = {
  id?: string | number
  name?: string
  thread_id?: string | number | null
}

type RawPlatform = {
  id?: string
  name?: string
  enabled?: boolean
  configured?: boolean
  state?: string
  home_channel?: ChannelPlatform['homeChannel']
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}

/** Unscoped = the profile an unprefixed gateway request reaches. */
async function resolveProfileName(profile: string | null): Promise<string> {
  if (profile) return profile
  const mode = await getGatewayMode()
  if (mode.mode === 'single') return mode.activeProfile
  if (mode.mode === 'multiplex') return 'default'
  return getActiveProfileName()
}

function profileHome(profile: string): string {
  return profile === 'default' ? getHermesRoot() : getProfileHermesHome(profile)
}

function openDb(profile: string, readonly: boolean) {
  const path = join(profileHome(profile), 'state.db')
  if (!existsSync(path)) return null
  const db = new Database(path, { readonly, fileMustExist: true })
  db.pragma('busy_timeout = 5000')
  return db
}

function readRow(db: Database.Database, id: string): ChannelRow | null {
  return (
    (db
      .prepare(
        `SELECT id, source, chat_id, thread_id, title, handoff_state,
                handoff_platform, handoff_error, handoff_requested_at
         FROM sessions WHERE id = ?`,
      )
      .get(id) as ChannelRow | undefined) ?? null
  )
}

/** Unpatched hermes-agent has no `handoff_target` → only new-topic handoff. */
function hasTargetColumn(db: Database.Database): boolean {
  return (db.pragma('table_info(sessions)') as Array<{ name: string }>).some(
    (c) => c.name === 'handoff_target',
  )
}

const MAX_TARGETS = 30

/** Existing topics the gateway will accept as a handoff target: thread
 *  entries of `channel_directory.json`, labelled from state.db, newest first. */
function readTargets(
  profile: string,
  db: Database.Database,
  platforms: Array<ChannelPlatform>,
  current: ChannelRow | null,
): Array<ChannelTarget> {
  let dir: { platforms?: Record<string, Array<RawDirEntry>> }
  try {
    dir = JSON.parse(
      readFileSync(
        join(profileHome(profile), 'channel_directory.json'),
        'utf8',
      ),
    )
  } catch {
    return []
  }
  const out: Array<ChannelTarget> = []
  for (const p of platforms) {
    if (p.unavailableReason) continue
    // Newest first, so the first row per topic carries its last activity and
    // the first non-null title is the most recent one.
    const seen = new Map<
      string,
      { title: string | null; last: number | null }
    >()
    for (const r of db
      .prepare(
        `SELECT chat_id, thread_id, title,
                COALESCE(last_activity_at, started_at) AS last
         FROM sessions WHERE source = ? AND thread_id IS NOT NULL
         ORDER BY last DESC`,
      )
      .all(p.id) as Array<{
      chat_id: string
      thread_id: string
      title: string | null
      last: number | null
    }>) {
      const k = `${r.chat_id}:${r.thread_id}`
      const hit = seen.get(k)
      if (!hit) seen.set(k, { title: r.title, last: r.last })
      else if (!hit.title) hit.title = r.title
    }
    for (const e of dir.platforms?.[p.id] ?? []) {
      const threadId = e.thread_id ? String(e.thread_id) : ''
      const chatId = String(e.id ?? '').split(':')[0]
      if (!threadId || !chatId) continue
      if (
        current?.source === p.id &&
        current.chat_id === chatId &&
        current.thread_id === threadId
      )
        continue
      const row = seen.get(`${chatId}:${threadId}`)
      out.push({
        target: `${p.id}:${chatId}:${threadId}`,
        platform: p.id,
        chatId,
        threadId,
        label: row?.title || e.name || `topic ${threadId}`,
        lastActive: row?.last ?? null,
      })
    }
  }
  return out.sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0))
}

async function readPlatforms(profile: string): Promise<Array<ChannelPlatform>> {
  const res = await dashboardFetch(
    `/api/messaging/platforms?profile=${encodeURIComponent(profile)}`,
  )
  if (!res.ok)
    throw new Error(`Messaging platforms unavailable (${res.status})`)
  const body = (await res.json()) as { platforms?: Array<RawPlatform> }
  return (body.platforms ?? [])
    .filter(
      (p) => p.id && HANDOFF_PLATFORMS.has(p.id) && (p.enabled || p.configured),
    )
    .map((p) => ({
      id: p.id!,
      name: p.name || p.id!,
      state: p.state || 'unknown',
      homeChannel: p.home_channel ?? null,
      unavailableReason: !p.enabled
        ? 'Not enabled'
        : !p.configured
          ? 'Not configured'
          : !p.home_channel
            ? 'No home channel set'
            : p.state !== 'connected'
              ? `Not connected (${p.state || 'unknown'})`
              : null,
    }))
}

export const Route = createFileRoute('/api/sessions/$sessionKey/channel')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request))
          return json({ ok: false, error: 'Unauthorized' }, 401)
        const sessionKey = params.sessionKey.trim()
        const rawProfile = readProfile(
          new URL(request.url).searchParams.get('profile'),
        )
        if (rawProfile && !isValidProfileName(rawProfile))
          return json({ ok: false, error: 'Invalid profile' }, 400)
        try {
          const profile = await resolveProfileName(rawProfile)
          const platforms = await readPlatforms(profile).catch(() => [])
          const db = openDb(profile, true)
          let session: ChannelRow | null = null
          let targets: Array<ChannelTarget> = []
          try {
            session = db ? readRow(db, sessionKey) : null
            if (db && session && hasTargetColumn(db))
              targets = readTargets(profile, db, platforms, session).slice(
                0,
                MAX_TARGETS,
              )
          } finally {
            db?.close()
          }
          return json({ ok: true, profile, session, platforms, targets })
        } catch (err) {
          return json(
            {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            },
            500,
          )
        }
      },

      POST: async ({ request, params }) => {
        if (!isAuthenticated(request))
          return json({ ok: false, error: 'Unauthorized' }, 401)
        const csrf = requireJsonContentType(request)
        if (csrf) return csrf
        const sessionKey = params.sessionKey.trim()
        const body = (await request.json().catch(() => ({}))) as {
          platform?: unknown
          profile?: unknown
          target?: unknown
        }
        const platform =
          typeof body.platform === 'string'
            ? body.platform.trim().toLowerCase()
            : ''
        if (!platform)
          return json({ ok: false, error: 'platform required' }, 400)
        const handoffTarget =
          typeof body.target === 'string' && body.target.trim()
            ? body.target.trim()
            : null
        if (
          handoffTarget &&
          !new RegExp(
            `^${platform.replace(/[^a-z0-9_]/g, '')}:-?\\d+(:\\d+)?$`,
          ).test(handoffTarget)
        )
          return json({ ok: false, error: 'Invalid target' }, 400)
        const rawProfile =
          readProfile(body.profile) ??
          readProfile(new URL(request.url).searchParams.get('profile'))
        if (rawProfile && !isValidProfileName(rawProfile))
          return json({ ok: false, error: 'Invalid profile' }, 400)

        try {
          const profile = await resolveProfileName(rawProfile)
          const platforms = await readPlatforms(profile)
          const target = platforms.find((p) => p.id === platform)
          if (!target || target.unavailableReason)
            return json(
              {
                ok: false,
                error: `platform '${platform}' is not available for ${profile}: ${
                  target?.unavailableReason ?? 'not configured/enabled'
                }`,
              },
              409,
            )
          // Same refusal as RPC handoff.request (4009): a mid-turn switch_session
          // would orphan the running turn.
          if (await getActiveRunForSession(scopeKey(rawProfile, sessionKey)))
            return json(
              {
                ok: false,
                error: 'Session busy — wait for the current turn to finish',
              },
              409,
            )
          const db = openDb(profile, false)
          if (!db) return json({ ok: false, error: 'Session not found' }, 404)
          try {
            const targetColumn = hasTargetColumn(db)
            if (handoffTarget) {
              if (!targetColumn)
                return json(
                  {
                    ok: false,
                    error:
                      'This hermes-agent cannot continue in an existing topic',
                  },
                  409,
                )
              const home = target.homeChannel?.chat_id
              const allowed =
                (home && handoffTarget === `${platform}:${home}`) ||
                readTargets(
                  profile,
                  db,
                  [target],
                  readRow(db, sessionKey),
                ).some((t) => t.target === handoffTarget)
              if (!allowed)
                return json(
                  { ok: false, error: 'Target is not a known topic' },
                  409,
                )
            }
            // Mirrors request_handoff_status: the guard refuses to re-arm a
            // pending/running row, so a double click never queues twice.
            // The active-run check above is check-then-act: a turn starting
            // between it and this UPDATE is not caught here. Accepted — the
            // window is milliseconds and there is no cross-process run lock.
            const { changes, session } = db
              .transaction(() => {
                const res = db
                  .prepare(
                    `UPDATE sessions
                     SET handoff_state = 'pending', handoff_platform = ?,
                         handoff_error = NULL, handoff_requested_at = ?${
                           targetColumn ? ', handoff_target = ?' : ''
                         }
                     WHERE id = ? AND (handoff_state IS NULL
                                       OR handoff_state IN ('completed', 'failed'))`,
                  )
                  .run(
                    ...[platform, Date.now() / 1000],
                    ...(targetColumn ? [handoffTarget] : []),
                    sessionKey,
                  )
                return {
                  changes: res.changes,
                  session: readRow(db, sessionKey),
                }
              })
              .immediate()
            if (!session)
              return json({ ok: false, error: 'Session not found' }, 404)
            if (changes === 0)
              return json(
                { ok: false, error: 'Handoff already in flight', session },
                409,
              )
            return json({ ok: true, profile, session })
          } finally {
            db.close()
          }
        } catch (err) {
          return json(
            {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            },
            500,
          )
        }
      },
    },
  },
})
