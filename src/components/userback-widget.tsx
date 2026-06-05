import { useEffect } from 'react'

/**
 * Userback visual-feedback widget. Lets any Switch UI user file a bug report
 * with a screenshot/annotation, sent to the Interstellar-code Userback account.
 *
 * The access token is a PUBLIC client-side widget token (safe to ship). Override
 * it per-deployment, or disable the widget entirely, via env:
 *   VITE_USERBACK_TOKEN=<your-token>   use a different Userback account
 *   VITE_USERBACK_TOKEN=off            disable the widget
 */
const DEFAULT_USERBACK_TOKEN = 'P-xBQyz1HdrhM4J1PlIMuWeSt1Z'

const USERBACK_SRC = 'https://static.userback.io/widget/v1.js'
const SCRIPT_ID = 'userback-widget-script'

export function UserbackWidget() {
  useEffect(() => {
    if (typeof window === 'undefined') return

    const token = (
      import.meta.env.VITE_USERBACK_TOKEN ?? DEFAULT_USERBACK_TOKEN
    ).trim()
    if (!token || token === 'off') return

    // Load once even across remounts.
    if (document.getElementById(SCRIPT_ID)) return

    const w = window as typeof window & { Userback?: Record<string, unknown> }
    w.Userback = w.Userback || {}
    w.Userback.access_token = token

    const s = document.createElement('script')
    s.id = SCRIPT_ID
    s.async = true
    s.src = USERBACK_SRC
    document.head.appendChild(s)
  }, [])

  return null
}
