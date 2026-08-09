import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useGatewayRestartStore } from '@/stores/gateway-restart-store'
import { gatewayRestart } from '@/lib/hermes-client'
import { cn } from '@/lib/utils'

const RESTART_HINT = 'hermes gateway restart'

/**
 * Bounds for the post-action confirmation poll. We never loop forever: after
 * ~30s of the gateway not answering a fresh probe, we give up and point the
 * user back at the manual command instead of spinning silently.
 */
export const RESTART_POLL_INTERVAL_MS = 2_000
export const RESTART_POLL_TIMEOUT_MS = 30_000

const SUCCESS_AUTO_DISMISS_MS = 2_500

interface GatewayStatusResponse {
  capabilities?: { health?: boolean; authError?: boolean }
}

interface GatewayReprobeResponse {
  gateway?: { available?: boolean }
}

function useGatewayHealth(enabled: boolean) {
  return useQuery<GatewayStatusResponse>({
    queryKey: ['gateway-status'],
    queryFn: async () => {
      const res = await fetch('/api/gateway-status')
      if (!res.ok) throw new Error('gateway-status fetch failed')
      return res.json()
    },
    enabled,
    staleTime: 10_000,
    refetchInterval: enabled ? 15_000 : false,
  })
}

type ActionPhase =
  | { kind: 'idle' }
  | { kind: 'working'; label: string }
  | { kind: 'success'; message: string }
  | { kind: 'failure'; message: string }

/**
 * `POST /api/start-agent` (`startClaudeAgent()`) only ever spawns the gateway
 * when `/health` is unreachable — it checks health first and returns
 * "already running" as a no-op otherwise. It cannot restart a live process,
 * so it is only offered when the gateway is actually down.
 *
 * A real restart of a *running* gateway already exists elsewhere in this app
 * (Providers screen "Restart gateway", onboarding self-heal): `gatewayRestart()`
 * in `@/lib/hermes-client`, which POSTs the dashboard's `/api/gateway/restart`.
 * We reuse that exact mechanism here rather than reinventing one, and add the
 * confirmation poll + bounded timeout this banner promises that the Providers
 * screen's fire-and-forget version doesn't.
 */
export function GatewayRestartBanner() {
  const needsRestart = useGatewayRestartStore((s) => s.needsRestart)
  const profileName = useGatewayRestartStore((s) => s.profileName)
  const since = useGatewayRestartStore((s) => s.since)
  const dismiss = useGatewayRestartStore((s) => s.dismiss)
  const [copied, setCopied] = useState(false)
  const [action, setAction] = useState<ActionPhase>({ kind: 'idle' })

  const pollTimerRef = useRef<number | null>(null)
  const dismissTimerRef = useRef<number | null>(null)
  const mountedRef = useRef(true)

  const { data } = useGatewayHealth(needsRestart)
  const gatewayUp = data?.capabilities?.health === true
  const gatewayStatusKnown = data?.capabilities?.health !== undefined
  // A 401 on `/health` means the gateway IS up but this workspace's own
  // bearer token doesn't match what it expects — a config problem, not a
  // stopped process. Telling the user "the gateway looks like it stopped"
  // here would send them to restart/start a gateway that never went away.
  // See gateway-capabilities.ts's probeHealth() (W3 audit item 5).
  const authError = data?.capabilities?.authError === true

  const clearPollTimer = () => {
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }
  const clearDismissTimer = () => {
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = null
    }
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearPollTimer()
      clearDismissTimer()
    }
  }, [])

  // A fresh profile switch (new `since`) starts a new incident — any leftover
  // success/failure state or in-flight poll from a previous switch must not
  // bleed into it.
  useEffect(() => {
    setAction({ kind: 'idle' })
    clearPollTimer()
    clearDismissTimer()
  }, [since])

  if (!needsRestart) return null

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(RESTART_HINT)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — ignore */
    }
  }

  /** Force a live re-probe (bypasses the capability cache TTL) and report health. */
  async function probeHealthy(): Promise<boolean> {
    try {
      const res = await fetch('/api/gateway-reprobe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) return false
      const payload = (await res.json().catch(() => ({}))) as GatewayReprobeResponse
      return payload.gateway?.available === true
    } catch {
      return false
    }
  }

  function pollUntilHealthy(successMessage: string) {
    const deadline = Date.now() + RESTART_POLL_TIMEOUT_MS
    const tick = async () => {
      const healthy = await probeHealthy()
      if (!mountedRef.current) return
      if (healthy) {
        setAction({ kind: 'success', message: successMessage })
        clearDismissTimer()
        dismissTimerRef.current = window.setTimeout(() => {
          if (mountedRef.current) dismiss()
        }, SUCCESS_AUTO_DISMISS_MS)
        return
      }
      if (Date.now() >= deadline) {
        setAction({
          kind: 'failure',
          message: `Gateway did not come back within ${Math.round(RESTART_POLL_TIMEOUT_MS / 1000)}s. Use the command below.`,
        })
        return
      }
      pollTimerRef.current = window.setTimeout(() => void tick(), RESTART_POLL_INTERVAL_MS)
    }
    void tick()
  }

  async function handleStart() {
    setAction({ kind: 'working', label: 'Starting…' })
    try {
      const res = await fetch('/api/start-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
      }
      if (!res.ok || payload.ok !== true) {
        throw new Error(payload.error || 'Failed to start the gateway')
      }
    } catch (error) {
      if (!mountedRef.current) return
      setAction({
        kind: 'failure',
        message: error instanceof Error ? error.message : 'Failed to start the gateway',
      })
      return
    }
    pollUntilHealthy('Gateway started — the new config is live.')
  }

  async function handleRestart() {
    setAction({ kind: 'working', label: 'Restarting…' })
    try {
      await gatewayRestart()
    } catch (error) {
      if (!mountedRef.current) return
      setAction({
        kind: 'failure',
        message: error instanceof Error ? error.message : 'Failed to restart the gateway',
      })
      return
    }
    pollUntilHealthy('Gateway restarted — the new config is live.')
  }

  const isWorking = action.kind === 'working'

  let statusText: ReactNode
  if (action.kind === 'success') {
    statusText = <span>✓ {action.message}</span>
  } else if (action.kind === 'failure') {
    statusText = (
      <span>
        {action.message} Or restart it manually:
      </span>
    )
  } else {
    statusText = (
      <>
        Profile switched
        {profileName ? (
          <>
            {' '}to <strong className="font-semibold">{profileName}</strong>
          </>
        ) : null}
        .{' '}
        {authError
          ? "The gateway is reachable, but its token doesn't match this workspace's " +
            'HERMES_API_TOKEN — check ~/.hermes/.env\'s API_SERVER_KEY (or HERMES_API_TOKEN) ' +
            'and restart once they agree.'
          : gatewayStatusKnown && !gatewayUp
            ? 'The gateway looks like it stopped — start it to pick up the new config.'
            : 'Restart the Hermes Agent gateway for the new config to take effect.'}
      </>
    )
  }

  const actionButton =
    action.kind !== 'success' && gatewayStatusKnown ? (
      <button
        type="button"
        onClick={() => void (gatewayUp ? handleRestart() : handleStart())}
        disabled={isWorking}
        className="shrink-0 rounded border border-amber-400 dark:border-amber-600 px-2 py-1 text-[11px] font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isWorking ? action.label : gatewayUp ? 'Restart gateway' : 'Start gateway'}
      </button>
    ) : null

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'sticky top-0 z-[180] flex items-center gap-3 border-b px-4 py-2 text-xs font-mono',
        'bg-amber-50 text-amber-900 border-amber-300',
        'dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-700/60',
      )}
    >
      <span aria-hidden="true">{action.kind === 'success' ? '✓' : '⚠'}</span>
      <span className="flex-1 min-w-0">{statusText}</span>
      {actionButton}
      <button
        type="button"
        onClick={() => void handleCopy()}
        className="shrink-0 rounded border border-amber-400 dark:border-amber-600 px-2 py-1 text-[11px] hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
        title="Copy restart command"
      >
        {copied ? '✓ copied' : `copy: ${RESTART_HINT}`}
      </button>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 rounded px-2 py-1 text-[11px] hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
        title="Dismiss"
        aria-label="Dismiss banner"
      >
        ✕
      </button>
    </div>
  )
}
