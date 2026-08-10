/**
 * GET /api/setup-diagnostics
 *
 * Specific, actionable findings about why the backend is not working —
 * rendered by `connection-startup-screen.tsx` in place of generic welcome
 * copy when a real install is broken.
 *
 * Two properties this endpoint must never lose:
 *
 *  1. **It never throws.** A diagnostics endpoint that 500s exactly when
 *     things are broken is worthless. `runSetupDiagnostics()` already
 *     degrades every check independently; this handler adds a final belt so
 *     that even a total failure returns a well-formed 200 payload the screen
 *     can render.
 *  2. **It never returns a secret.** Tokens are compared by truncated
 *     SHA-256 fingerprint inside `setup-diagnostics.ts`; no value reaches
 *     here.
 *
 * Auth-gated with `isAuthenticated`, like its neighbours (`gateway-status`,
 * `connection-status`) — the payload carries local filesystem paths and
 * profile names, which a password-protected deployment should not hand out
 * to an unauthenticated caller.
 */
import { createFileRoute } from '@tanstack/react-router'

import { isAuthenticated } from '../../server/auth-middleware'
import { runSetupDiagnostics } from '../../server/setup-diagnostics'
import type { SetupDiagnostics } from '../../server/setup-diagnostics'

/** Last-resort payload for the case where even the orchestrator failed. */
function degradedPayload(err: unknown): SetupDiagnostics {
  return {
    generatedAt: new Date().toISOString(),
    gatewayUrl: '',
    dashboardUrl: '',
    severity: 'unknown',
    // `null`, never `false`: claiming "no gateway is running" on the strength
    // of a crashed diagnosis is what puts a useless Auto-Start button back on
    // the screen.
    gatewayProcessRunning: null,
    missingCapabilities: [],
    firstRun: false,
    findings: [
      {
        id: 'diagnostics-unavailable',
        severity: 'unknown',
        title: 'Setup diagnostics could not be collected.',
        detail: err instanceof Error ? err.message : String(err),
        remedy:
          'Check the workspace server logs. The backend problem, if there is one, is still unreported.',
      },
    ],
  }
}

export const Route = createFileRoute('/api/setup-diagnostics')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          if (!isAuthenticated(request)) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 })
          }
        } catch {
          // An auth check that throws must fail closed.
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        try {
          const diagnostics = await runSetupDiagnostics()
          return Response.json(diagnostics)
        } catch (err) {
          console.warn('[setup-diagnostics] collection failed:', err)
          return Response.json(degradedPayload(err))
        }
      },
    },
  },
})
