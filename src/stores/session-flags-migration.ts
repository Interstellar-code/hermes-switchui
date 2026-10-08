/**
 * session-flags-migration.ts — one-time overlay→backend migration.
 *
 * When backend-backed archive/pin ships, the localStorage overlay
 * (`hermes.sessions.local`) may still hold `chat:` ids the user archived or
 * pinned locally. On first load each `chat:` id in `archived[]`/`pinned[]` is
 * PATCHed to the backend; ids that succeed or hit 404 (session gone) are
 * dropped from the overlay, failures stay for the next load, and
 * `backendFlagsMigrated` in the persisted store marks completion so this runs
 * once. `task:`/`cron:` ids and all `starred[]` stay local — the backend has
 * no row for them.
 *
 * Multi-tab safe without a lock: the PATCHes are idempotent, id removal is
 * set-like, and a stale overlay id resurrected by another tab's write either
 * matches the backend state already or re-migrates harmlessly on a later load.
 */

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSessionsLocalStore } from './sessions-local-store'
import { invalidateSessionLists } from '@/screens/chat/sessions-feed'

type MigrationOutcome = 'ok' | 'gone' | 'failed'

type MigrationResult = { migrated: number; gone: number; failed: number }

const rawIdOf = (id: string) => id.split(':').slice(1).join(':')

async function readFailure(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: unknown; message?: unknown }
    if (data.error) return String(data.error)
    if (data.message) return String(data.message)
  } catch {
    /* fall through */
  }
  return res.statusText || 'request failed'
}

async function patchSessionFlag(
  sessionKey: string,
  flag: { archived: true } | { pinned: true },
): Promise<MigrationOutcome> {
  try {
    const res = await fetch('/api/sessions', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionKey, ...flag }),
    })
    if (res.ok) return 'ok'
    // The route maps a backend 404 to a 500 whose message embeds ": 404" —
    // either spelling means the session is gone, i.e. nothing left to migrate.
    const message = await readFailure(res)
    if (res.status === 404 || message.includes('404')) return 'gone'
    return 'failed'
  } catch {
    return 'failed'
  }
}

function waitForHydration(timeoutMs = 5_000): Promise<void> {
  const store = useSessionsLocalStore
  if (store.persist.hasHydrated()) return Promise.resolve()
  return new Promise((resolve) => {
    // eslint-disable-next-line prefer-const
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      clearTimeout(timer)
      unsubscribe()
      resolve()
    }
    const unsubscribe = store.persist.onFinishHydration(finish)
    timer = setTimeout(finish, timeoutMs)
  })
}

let migrationRun: Promise<MigrationResult> | null = null

export function resetBackendFlagsMigrationForTest(): void {
  migrationRun = null
}

export function runBackendFlagsMigration(): Promise<MigrationResult> {
  if (!migrationRun) {
    migrationRun = migrate().catch(() => ({ migrated: 0, gone: 0, failed: 0 }))
  }
  return migrationRun
}

async function migrate(): Promise<MigrationResult> {
  if (typeof window === 'undefined') {
    return { migrated: 0, gone: 0, failed: 0 }
  }
  await waitForHydration()

  const store = useSessionsLocalStore
  const { pinned, archived, backendFlagsMigrated } = store.getState()
  if (backendFlagsMigrated) {
    return { migrated: 0, gone: 0, failed: 0 }
  }

  const archIds = archived.filter((id) => id.startsWith('chat:'))
  const pinIds = pinned.filter((id) => id.startsWith('chat:'))
  if (archIds.length === 0 && pinIds.length === 0) {
    store.setState({ backendFlagsMigrated: true })
    return { migrated: 0, gone: 0, failed: 0 }
  }

  type Job = {
    id: string
    field: 'archived' | 'pinned'
    outcome: MigrationOutcome
  }
  const jobs = await Promise.all<Job>(
    [
      ...archIds.map((id) => ({ id, field: 'archived' as const })),
      ...pinIds.map((id) => ({ id, field: 'pinned' as const })),
    ].map(async (job) => ({
      ...job,
      outcome: await patchSessionFlag(
        rawIdOf(job.id),
        job.field === 'archived' ? { archived: true } : { pinned: true },
      ),
    })),
  )

  const settled = (
    field: 'archived' | 'pinned',
    outcomes: Array<MigrationOutcome>,
  ) =>
    new Set(
      jobs
        .filter((job) => job.field === field && outcomes.includes(job.outcome))
        .map((job) => job.id),
    )
  const resolvedArchived = settled('archived', ['ok', 'gone'])
  const resolvedPinned = settled('pinned', ['ok', 'gone'])
  const failedCount = jobs.filter((job) => job.outcome === 'failed').length

  store.setState((s) => ({
    archived: s.archived.filter((id) => !resolvedArchived.has(id)),
    pinned: s.pinned.filter((id) => !resolvedPinned.has(id)),
    backendFlagsMigrated: failedCount === 0,
  }))

  return {
    migrated: jobs.filter((job) => job.outcome === 'ok').length,
    gone: jobs.filter((job) => job.outcome === 'gone').length,
    failed: failedCount,
  }
}

/**
 * Fire the migration once per page load from the sidebar shell. When it moved
 * something to the backend, refresh the session lists so migrated pins/archives
 * are reflected instead of waiting for the next poll.
 */
export function useBackendFlagsMigration(): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    let cancelled = false
    void runBackendFlagsMigration().then((result) => {
      if (!cancelled && result.migrated + result.gone > 0) {
        invalidateSessionLists(queryClient)
      }
    })
    return () => {
      cancelled = true
    }
  }, [queryClient])
}
