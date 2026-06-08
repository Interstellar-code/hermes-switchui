import { useEffect } from 'react'
import { useChatStore } from '../../../stores/chat-store'

export type ActiveRunStatus =
  | 'accepted'
  | 'active'
  | 'handoff'
  | 'stalled'
  | 'complete'
  | 'error'

export type ActiveRunSnapshot = {
  runId: string
  status: ActiveRunStatus
  sessionKey: string
  startedAt?: number
  createdAt?: number
  updatedAt?: number
  lastEventAt?: number
}

type ActiveRunResponse = {
  ok: boolean
  run: ActiveRunSnapshot | null
}

const RECOVERABLE_HANDOFF_WINDOW_MS = 30_000
const ACTIVE_RUN_CHECK_RETRY_MS = 1_500
const ACTIVE_RUN_CHECK_MAX_ATTEMPTS = 3

export function isRecoverableActiveRun(
  run: ActiveRunSnapshot | null,
  now = Date.now(),
): run is ActiveRunSnapshot {
  if (!run) return false
  if (run.status === 'accepted' || run.status === 'active') return true
  if (run.status !== 'handoff') return false

  const lastActivityAt =
    run.lastEventAt ?? run.updatedAt ?? run.startedAt ?? run.createdAt
  return (
    typeof lastActivityAt === 'number' &&
    now - lastActivityAt <= RECOVERABLE_HANDOFF_WINDOW_MS
  )
}

/**
 * On mount, checks whether the server has an active run for this session.
 * If so, marks the session as waiting in the persistent Zustand store.
 * If the server says the run is done, clears the stale waiting state.
 *
 * This closes the gap where a user navigates away during streaming,
 * the component unmounts (losing local state), and on remount the UI
 * doesn't know a run was in progress.
 */
export function useActiveRunCheck({
  sessionKey,
  enabled,
}: {
  sessionKey: string
  enabled: boolean
}): void {
  useEffect(() => {
    if (!enabled || !sessionKey || sessionKey === 'new') return

    const controller = new AbortController()
    let retryTimer: number | null = null
    let attempts = 0

    async function check() {
      attempts += 1
      try {
        const response = await fetch(
          `/api/sessions/${encodeURIComponent(sessionKey)}/active-run`,
          { signal: controller.signal },
        )
        if (!response.ok)
          throw new Error(`Active run check failed: ${response.status}`)

        const data = (await response.json()) as ActiveRunResponse
        if (!data.ok) throw new Error('Active run check returned an error')

        const store = useChatStore.getState()
        if (isRecoverableActiveRun(data.run)) {
          store.setSessionWaiting(sessionKey, data.run.runId)
        } else if (store.isSessionWaiting(sessionKey)) {
          // Server says run is done but we still have stale waiting state
          store.clearSessionWaiting(sessionKey)
        }
      } catch {
        if (
          !controller.signal.aborted &&
          attempts < ACTIVE_RUN_CHECK_MAX_ATTEMPTS
        ) {
          retryTimer = window.setTimeout(check, ACTIVE_RUN_CHECK_RETRY_MS)
        }
      }
    }

    void check()

    return () => {
      controller.abort()
      if (retryTimer) window.clearTimeout(retryTimer)
    }
  }, [sessionKey, enabled])
}
