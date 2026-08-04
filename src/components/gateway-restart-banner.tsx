import { useState } from 'react'
import { useGatewayRestartStore } from '@/stores/gateway-restart-store'
import { cn } from '@/lib/utils'

const RESTART_HINT = 'hermes gateway restart'

export function GatewayRestartBanner() {
  const needsRestart = useGatewayRestartStore((s) => s.needsRestart)
  const profileName = useGatewayRestartStore((s) => s.profileName)
  const dismiss = useGatewayRestartStore((s) => s.dismiss)
  const [copied, setCopied] = useState(false)

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
        Profile switched
        {profileName ? (
          <>
            {' '}to <strong className="font-semibold">{profileName}</strong>
          </>
        ) : null}
        . Restart the Hermes Agent gateway for the new config to take effect.
      </span>
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
