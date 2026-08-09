/**
 * `/api/agent-cwd` — where the AGENT will actually run, and why.
 *
 * Distinct from `/api/workspace`, which only moves the Files-browser jail root
 * and has never had any effect on the agent. This endpoint is the only place in
 * Switch UI that can change where the agent's shell commands execute, which is
 * why the POST handler supports a `dryRun` preview: the caller shows the user
 * the before → after directory and only writes on explicit confirmation.
 *
 * The gateway reads `terminal.cwd` once at import time, so a successful write
 * always reports `needsGatewayRestart: true`.
 */
import { createFileRoute } from '@tanstack/react-router'
import {
  AgentCwdValidationError,
  getAgentCwdStatus,
  previewAgentCwd,
  writeAgentCwd,
} from '../../server/agent-cwd'
import { isAuthenticated } from '../../server/auth-middleware'
import { requireJsonContentType } from '../../server/rate-limit'
import { loadWorkspaceCatalog } from './workspace'

function unauthorized(): Response {
  return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}

/** Best-effort: the Files-browser root is the best available *suggestion* for a
 *  one-click fix, even though the two mechanisms are unrelated. */
async function suggestedWorkspacePath(): Promise<string | null> {
  try {
    const catalog = await loadWorkspaceCatalog()
    return catalog.isValid ? catalog.path : null
  } catch {
    return null
  }
}

export const Route = createFileRoute('/api/agent-cwd')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) return unauthorized()
        try {
          const url = new URL(request.url)
          const profile = url.searchParams.get('profile')?.trim() || undefined
          const status = await getAgentCwdStatus({
            profile,
            suggestedWorkspace: await suggestedWorkspacePath(),
          })
          return Response.json({ ok: true, ...status })
        } catch (err) {
          return Response.json(
            { ok: false, error: err instanceof Error ? err.message : String(err) },
            { status: 500 },
          )
        }
      },

      POST: async ({ request }) => {
        if (!isAuthenticated(request)) return unauthorized()
        const contentTypeError = requireJsonContentType(request)
        if (contentTypeError) return contentTypeError

        let body: { path?: unknown; profile?: unknown; dryRun?: unknown }
        try {
          body = (await request.json()) as typeof body
        } catch {
          return Response.json(
            { ok: false, error: 'Invalid JSON body' },
            { status: 400 },
          )
        }

        const requestedPath =
          typeof body.path === 'string' ? body.path.trim() : ''
        const requestedProfile =
          typeof body.profile === 'string' ? body.profile.trim() : ''
        const dryRun = body.dryRun === true

        try {
          const before = await getAgentCwdStatus({
            profile: requestedProfile || undefined,
          })

          // Refuse the write outright rather than persisting a value the
          // running process will ignore. Under multiplex, a non-launch
          // profile's terminal settings never reach the agent.
          if (!before.editable) {
            return Response.json(
              {
                ok: false,
                error:
                  `Editing "${before.activeProfile}" would have no effect: this gateway is ` +
                  `multiplexing and takes its working directory from the launch profile ` +
                  `"${before.resolved.profile}". Edit that profile, or restart the gateway ` +
                  `on "${before.activeProfile}".`,
                before: before.resolved,
              },
              { status: 409 },
            )
          }

          if (dryRun) {
            const after = await previewAgentCwd(before.activeProfile, requestedPath)
            return Response.json({
              ok: true,
              dryRun: true,
              profile: before.activeProfile,
              before: before.resolved,
              after,
              needsGatewayRestart: false,
            })
          }

          const written = writeAgentCwd(before.activeProfile, requestedPath)
          const after = await getAgentCwdStatus({ profile: before.activeProfile })
          return Response.json({
            ok: true,
            dryRun: false,
            profile: before.activeProfile,
            written,
            before: before.resolved,
            after: after.resolved,
            // config.yaml is read once at gateway import time.
            needsGatewayRestart: true,
          })
        } catch (err) {
          const status = err instanceof AgentCwdValidationError ? 400 : 500
          return Response.json(
            { ok: false, error: err instanceof Error ? err.message : String(err) },
            { status },
          )
        }
      },
    },
  },
})
