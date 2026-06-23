const ACTIVE_RUNS_KEY = '__claude_active_send_runs__' as const

// TTL for active run entries: 12 minutes. A send run that has been registered
// for longer than this is almost certainly orphaned (crash, stale server state).
const RUN_TTL_MS = 12 * 60 * 1000

type RunEntry = { registeredAt: number }

function getActiveRuns(): Map<string, RunEntry> {
  const globalValue = globalThis as Record<string, unknown>
  if (!globalValue[ACTIVE_RUNS_KEY]) {
    globalValue[ACTIVE_RUNS_KEY] = new Map<string, RunEntry>()
  }
  return globalValue[ACTIVE_RUNS_KEY] as Map<string, RunEntry>
}

/** Sweep entries older than RUN_TTL_MS. Called on each register to bound growth. */
function sweepExpiredRuns(): void {
  const runs = getActiveRuns()
  const cutoff = Date.now() - RUN_TTL_MS
  for (const [id, entry] of runs) {
    if (entry.registeredAt < cutoff) {
      runs.delete(id)
    }
  }
}

export function registerActiveSendRun(runId: string): void {
  if (!runId) return
  sweepExpiredRuns()
  getActiveRuns().set(runId, { registeredAt: Date.now() })
}

export function unregisterActiveSendRun(runId: string): void {
  if (!runId) return
  getActiveRuns().delete(runId)
}

export function hasActiveSendRun(runId: string | null | undefined): boolean {
  if (!runId) return false
  return getActiveRuns().has(runId)
}
