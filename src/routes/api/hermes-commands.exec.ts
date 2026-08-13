import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { requireJsonContentType } from '../../server/rate-limit'
import {
  CLAUDE_DASHBOARD_URL,
  ensureGatewayProbed,
} from '../../server/gateway-capabilities'
import {
  catalogPolicyInputs,
  getHermesCommandCatalog,
} from '../../server/hermes-commands'
import { runSlashCommand } from '../../server/hermes-slash-exec'

/**
 * `POST /api/hermes-commands/exec` — run one Hermes agent slash command.
 *
 * Phase 3 of `docs/plans/hermes-slash-commands-in-switchui.md`.
 *
 * **This route is the control.** The picker only advertises commands the
 * allowlist can run, but hiding a command is not a control: every request is
 * re-evaluated here against `server/hermes-slash-policy.ts` and refused by
 * default. A refusal is a `403` carrying the reason, so the user is told why
 * rather than being handed a command that silently does nothing — which is the
 * failure mode `slash.exec` produces on its own (§2.5, hermes-agent#219).
 *
 * That includes the **agent-version floor**
 * (`MIN_AGENT_VERSION_FOR_SLASH_EXEC`). `runSlashCommand` reads the running
 * agent's version itself, per request, and refuses every allowlisted command
 * below the floor — it does not consult the catalog's `runnable` flag, and
 * there is no field on the request or on `RunSlashCommandOptions` through
 * which a caller could supply a version. So a hand-crafted POST against this
 * route on an old agent is refused exactly as the picker's own click would be,
 * with a `403` whose reason names the required version and the running one.
 * Skill commands and bundle slugs are unaffected by the floor and keep
 * working.
 *
 * Request:  `{ "command": "/status", "sessionId": "<chat session id>" }`
 * Response: `{ ok: true, command, result: <union> }`
 *           `{ ok: false, refused: true, command, reason }`  (403)
 *           `{ ok: false, mode: 'agent-commands-unavailable', … }` (503)
 */

const REQUEST_TIMEOUT_MESSAGE =
  'The agent did not answer in time. The command may still be running inside the agent.'

function unavailable(reason: string): Response {
  return Response.json(
    {
      ok: false,
      error: 'Agent commands unavailable',
      mode: 'agent-commands-unavailable',
      reason,
      dashboardUrl: CLAUDE_DASHBOARD_URL,
    },
    { status: 503 },
  )
}

export const Route = createFileRoute('/api/hermes-commands/exec')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!isAuthenticated(request)) {
          return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const body = (await request.json().catch(() => null)) as {
          command?: unknown
          sessionId?: unknown
        } | null

        const command =
          typeof body?.command === 'string' ? body.command.trim() : ''
        if (!command.startsWith('/')) {
          return Response.json(
            { ok: false, error: 'A slash command is required' },
            { status: 400 },
          )
        }
        const sessionId =
          typeof body?.sessionId === 'string' ? body.sessionId.trim() : ''

        const capabilities = await ensureGatewayProbed()
        if (!capabilities.agentCommands) {
          return unavailable(
            capabilities.dashboard.available
              ? 'commands-catalog-unavailable'
              : 'dashboard-unavailable',
          )
        }

        // The alias map, the skill-command set and the bundle-slug set all come
        // from the live catalog, so `/fork` resolves before the allowlist is
        // consulted and this installation's own skills and bundles are
        // dispatchable. A catalog failure is NOT fatal: the allowlist still
        // works without aliases, it just cannot recognize skill or bundle
        // commands, and refusing is the safe direction.
        let aliases: Record<string, string> | undefined
        let skillCommands: Set<string> | undefined
        let bundleCommands: Set<string> | undefined
        try {
          const inputs = catalogPolicyInputs(await getHermesCommandCatalog())
          aliases = inputs.aliases
          skillCommands = inputs.skillCommands
          bundleCommands = inputs.bundleCommands
        } catch {
          aliases = undefined
          skillCommands = undefined
          bundleCommands = undefined
        }

        try {
          const outcome = await runSlashCommand(command, {
            chatSessionId: sessionId || null,
            aliases,
            skillCommands,
            bundleCommands,
          })

          if (!outcome.ok) {
            return Response.json(outcome, { status: 403 })
          }
          return Response.json(outcome)
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Command failed'
          const timedOut = /timeout/i.test(message)
          return Response.json(
            {
              ok: false,
              command,
              error: timedOut ? REQUEST_TIMEOUT_MESSAGE : message,
            },
            { status: timedOut ? 504 : 502 },
          )
        }
      },
    },
  },
})
