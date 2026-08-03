/**
 * Layer 4 — runPersistence adapter (Track 2 / Phase 2.3).
 *
 * Dumb I/O only. No conditionals, no policy, no business logic. The
 * store calls into here for sessionStorage/localStorage reads and
 * writes. This module is the SOLE place chat-run state touches the
 * storage backends — the F4 pre-mortem guard (adapter god-object)
 * is honored by keeping it policy-free.
 *
 * Keys are byte-identical to the legacy inline calls in `chat-store.ts`:
 *   - `claude_streaming_<sk>` (60s, sessionStorage)
 *   - `claude_recovery_msg_<sk>` (5min, sessionStorage)
 *   - `claude_waiting_<sk>` (120s, sessionStorage)
 *   - `switchui:message-queue:<sk>` (sessionStorage after migration)
 *
 * Rollback safety: the queue migration (R3/Q1) keeps reading the
 * old localStorage key on first read for one release, drains it into
 * sessionStorage, then clears the localStorage key. After migration,
 * sessionStorage is the only writer.
 *
 * Profile scoping (P2): `<sk>` above is the composite key from
 * `@/lib/session-scope` — bare when no profile is selected (so every existing
 * entry keeps working untouched, no migration), `<profile>::<sk>` when one is.
 * Pre-existing bare-keyed entries therefore stay readable as exactly what they
 * are: unscoped state. They can never be served to a scoped session, because a
 * scoped read never looks at a bare slot.
 */

import { activeScopeKey } from '@/lib/session-scope'

const STREAMING_PREFIX = 'claude_streaming_'
const STREAMING_TTL_MS = 60_000
const RECOVERY_MSG_PREFIX = 'claude_recovery_msg_'
const RECOVERY_MSG_TTL_MS = 5 * 60 * 1000
const WAITING_PREFIX = 'claude_waiting_'
// 10 min — long enough to survive a user navigating away during a long run (#208)
const WAITING_TTL_MS = 600_000

const MESSAGE_QUEUE_PREFIX = 'switchui:message-queue:'
const MESSAGE_QUEUE_LEGACY_PREFIX = 'switchui:message-queue:' // same — both localStorage and sessionStorage

const MIGRATION_FLAG_KEY = 'switchui:queue-migrated-to-sessionstorage-v1'

// ── Streaming state ────────────────────────────────────────────────

export type StreamingStateRecord = Record<string, unknown> & {
  _savedAt?: number
}

export function persistStreamingState(
  sessionKey: string,
  state: StreamingStateRecord,
): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(
    `${STREAMING_PREFIX}${activeScopeKey(sessionKey)}`,
    JSON.stringify({ ...state, _savedAt: Date.now() }),
  )
}

export function restoreStreamingState(
  sessionKey: string,
): StreamingStateRecord | null {
  if (typeof sessionStorage === 'undefined') return null
  const raw = sessionStorage.getItem(
    `${STREAMING_PREFIX}${activeScopeKey(sessionKey)}`,
  )
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as StreamingStateRecord
    const savedAt = parsed._savedAt
    if (
      typeof savedAt !== 'number' ||
      Date.now() - savedAt > STREAMING_TTL_MS
    ) {
      sessionStorage.removeItem(
        `${STREAMING_PREFIX}${activeScopeKey(sessionKey)}`,
      )
      return null
    }
    const { _savedAt, ...rest } = parsed
    void _savedAt
    return rest
  } catch {
    sessionStorage.removeItem(
      `${STREAMING_PREFIX}${activeScopeKey(sessionKey)}`,
    )
    return null
  }
}

export function removeStreamingState(sessionKey: string): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.removeItem(`${STREAMING_PREFIX}${activeScopeKey(sessionKey)}`)
}

// ── Recovery message ───────────────────────────────────────────────

export function persistRecoveryMessage(
  sessionKey: string,
  message: unknown,
): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(
      `${RECOVERY_MSG_PREFIX}${activeScopeKey(sessionKey)}`,
      JSON.stringify({ message, storedAt: Date.now() }),
    )
  } catch {
    // Ignore quota / private mode failures — recovery is best-effort.
  }
}

export function restoreRecoveryMessage(sessionKey: string): unknown {
  if (typeof sessionStorage === 'undefined') return null
  const raw = sessionStorage.getItem(
    `${RECOVERY_MSG_PREFIX}${activeScopeKey(sessionKey)}`,
  )
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { message?: unknown; storedAt?: number }
    if (
      typeof parsed.storedAt !== 'number' ||
      Date.now() - parsed.storedAt > RECOVERY_MSG_TTL_MS
    ) {
      sessionStorage.removeItem(
        `${RECOVERY_MSG_PREFIX}${activeScopeKey(sessionKey)}`,
      )
      return null
    }
    return parsed.message ?? null
  } catch {
    sessionStorage.removeItem(
      `${RECOVERY_MSG_PREFIX}${activeScopeKey(sessionKey)}`,
    )
    return null
  }
}

export function clearRecoveryMessage(sessionKey: string): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.removeItem(
    `${RECOVERY_MSG_PREFIX}${activeScopeKey(sessionKey)}`,
  )
}

// ── Waiting state ──────────────────────────────────────────────────

export type WaitingMeta = { since: number; runId: string | null }

export function persistWaitingState(
  sessionKey: string,
  meta: WaitingMeta,
): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(
    `${WAITING_PREFIX}${activeScopeKey(sessionKey)}`,
    JSON.stringify(meta),
  )
}

export function removeWaitingState(sessionKey: string): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.removeItem(`${WAITING_PREFIX}${activeScopeKey(sessionKey)}`)
}

export function restoreAllWaitingSessions(): {
  keys: Set<string>
  meta: Record<string, WaitingMeta>
} {
  const keys = new Set<string>()
  const meta: Record<string, WaitingMeta> = {}
  if (typeof sessionStorage === 'undefined') return { keys, meta }

  const now = Date.now()
  for (let i = sessionStorage.length - 1; i >= 0; i--) {
    const key = sessionStorage.key(i)
    if (!key || !key.startsWith(WAITING_PREFIX)) continue
    const sessionKey = key.slice(WAITING_PREFIX.length)
    try {
      const parsed = JSON.parse(
        sessionStorage.getItem(key) ?? '',
      ) as WaitingMeta
      if (
        typeof parsed.since === 'number' &&
        now - parsed.since < WAITING_TTL_MS
      ) {
        keys.add(sessionKey)
        meta[sessionKey] = parsed
      } else {
        sessionStorage.removeItem(key)
      }
    } catch {
      sessionStorage.removeItem(key)
    }
  }
  return { keys, meta }
}

// ── Message queue (R3/Q1 migration: localStorage → sessionStorage) ─

function normalizeSessionKey(sessionKey: string): string {
  return sessionKey.trim() || 'main'
}

function queueKey(sessionKey: string): string {
  return `${MESSAGE_QUEUE_PREFIX}${activeScopeKey(normalizeSessionKey(sessionKey))}`
}

function isMigrationDone(): boolean {
  if (typeof localStorage === 'undefined') return true
  return localStorage.getItem(MIGRATION_FLAG_KEY) === '1'
}

function markMigrationDone(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(MIGRATION_FLAG_KEY, '1')
  } catch {
    // Ignore — best-effort marker.
  }
}

/**
 * Read queued messages for a session. On first call after deployment,
 * drains any matching `switchui:message-queue:<sk>` localStorage entries
 * into sessionStorage, then clears the localStorage keys (one-time
 * migration per client). Idempotent — safe to call multiple times.
 */
export function readQueuedMessages<T>(sessionKey: string): Array<T> {
  if (typeof sessionStorage === 'undefined') return []
  const key = queueKey(sessionKey)

  // One-time migration: if not yet done, copy any localStorage entries
  // with this prefix into sessionStorage.
  if (typeof localStorage !== 'undefined' && !isMigrationDone()) {
    migrateQueueFromLocalStorage()
  }

  const raw = sessionStorage.getItem(key)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as Array<T>
  } catch {
    sessionStorage.removeItem(key)
    return []
  }
}

export function writeQueuedMessages<T>(
  sessionKey: string,
  queue: Array<T>,
): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(queueKey(sessionKey), JSON.stringify(queue))
  } catch {
    // Ignore quota errors.
  }
}

export function clearQueuedMessages(sessionKey: string): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.removeItem(queueKey(sessionKey))
}

function migrateQueueFromLocalStorage(): void {
  if (
    typeof localStorage === 'undefined' ||
    typeof sessionStorage === 'undefined'
  ) {
    markMigrationDone()
    return
  }
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(MESSAGE_QUEUE_PREFIX)) continue
      const raw = localStorage.getItem(key)
      if (raw === null) continue
      // Copy to sessionStorage if not already there.
      if (sessionStorage.getItem(key) === null) {
        try {
          sessionStorage.setItem(key, raw)
        } catch {
          // Ignore quota.
        }
      }
      // Clear the localStorage entry — migration is one-way.
      localStorage.removeItem(key)
    }
  } finally {
    markMigrationDone()
  }
}
