import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'

const START_HINT = 'hermes dashboard --no-open --skip-build'

const SESSION_DISMISSED_KEY = 'hermes-dashboard-banner-dismissed'

interface GatewayStatus {
  capabilities: {
    health?: boolean
    // dashboard is a nested object, NOT a flat boolean
    dashboard?: { available?: boolean }
  }
}

function useGatewayStatus() {
  return useQuery<GatewayStatus>({
    queryKey: ['gateway-status'],
    queryFn: async () => {
      const res = await fetch('/api/gateway-status')
      if (!res.ok) throw new Error('gateway-status fetch failed')
      return res.json()
    },
    // Poll often: this drives a "Limited mode" banner that must clear quickly
    // once the dashboard is started. Pairs with the server's short probe TTL
    // while the dashboard is down (see effectiveProbeTtl in gateway-capabilities).
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  })
}

/**
 * Shown when the Hermes gateway is reachable (health=true) but the dashboard
 * service (port 9119) is not available. This "partial" state causes silent 503s
 * on sessions, skills, kanban, and jobs — this banner makes the degradation
 * explicit and actionable.
 *
 * Dismissible per-session (sessionStorage). Reappears on reload if still broken.
 */
export function DashboardUnavailableBanner() {
  const { data, isLoading } = useGatewayStatus()
  const [dismissed, setDismissed] = useState(() =>
    typeof window !== 'undefined'
      ? sessionStorage.getItem(SESSION_DISMISSED_KEY) === '1'
      : false,
  )
  const [copied, setCopied] = useState(false)

  const gatewayReachable = data?.capabilities.health === true
  const dashboardAvailable = data?.capabilities.dashboard?.available === true

  // Once the dashboard recovers, drop the per-session dismissal so the banner
  // shows again if it later goes down. Keeps the dismissed state from going stale.
  useEffect(() => {
    if (dashboardAvailable && dismissed) {
      sessionStorage.removeItem(SESSION_DISMISSED_KEY)
      setDismissed(false)
    }
  }, [dashboardAvailable, dismissed])

  if (isLoading || !data) return null

  // Only show when gateway is up but dashboard is down
  if (!gatewayReachable || dashboardAvailable || dismissed) return null

  const handleDismiss = () => {
    sessionStorage.setItem(SESSION_DISMISSED_KEY, '1')
    setDismissed(true)
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(START_HINT)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — ignore */
    }
  }

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
      <span aria-hidden="true">⚠</span>
      <span className="flex-1 min-w-0">
        <strong className="font-semibold">Limited mode — Hermes dashboard not connected.</strong>{' '}
        Sessions, skills, memory, kanban and jobs need the dashboard service (port 9119). Start it
        with:
      </span>
      <button
        type="button"
        onClick={() => void handleCopy()}
        className="shrink-0 rounded border border-amber-400 dark:border-amber-600 px-2 py-1 text-[11px] hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
        title="Copy start command"
      >
        {copied ? '✓ copied' : `copy: ${START_HINT}`}
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        className="shrink-0 rounded px-2 py-1 text-[11px] hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
        title="Dismiss"
        aria-label="Dismiss banner"
      >
        ✕
      </button>
    </div>
  )
}
