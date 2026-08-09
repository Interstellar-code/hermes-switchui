/**
 * `/api/hermes-docs` — serve the local Hermes Agent docs source
 * (the .md/.mdx tree under `~/.hermes/hermes-agent/website/docs/`) so
 * settings sections can link into real documentation instead of
 * re-explaining it in tooltips.
 *
 * `?path=` is relative to the docs root, e.g.
 * `user-guide/multi-profile-gateways.md`. Containment is enforced in
 * `src/server/hermes-docs.ts` (`resolveHermesDocPath`) — this handler only
 * translates its result codes to HTTP responses.
 *
 * Every non-2xx-worthy outcome still returns a `liveUrl` so the client can
 * fall back to the hosted docs site without a dead end — including when the
 * local checkout is simply absent, which is expected on installs that only
 * talk to a remote gateway.
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { hermesDocsLiveUrl, readHermesDoc } from '../../server/hermes-docs'

export const Route = createFileRoute('/api/hermes-docs')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(request.url)
        const rawPath = url.searchParams.get('path')
        if (!rawPath || rawPath.trim() === '') {
          return Response.json(
            { ok: false, error: 'Missing required parameter: path' },
            { status: 400 },
          )
        }

        const result = readHermesDoc(rawPath)
        const liveUrl = hermesDocsLiveUrl(rawPath)

        if (!result.ok) {
          // Absent local checkout is expected (not every install has the
          // source tree) — degrade to the live URL with a 200 rather than an
          // error the caller has to special-case.
          if (result.reason === 'no-docs-root') {
            return Response.json({ ok: false, error: result.message, liveUrl }, { status: 200 })
          }
          const status = result.reason === 'not-found' ? 404 : 400
          return Response.json({ ok: false, error: result.message, liveUrl }, { status })
        }

        return Response.json({
          ok: true,
          path: result.path,
          content: result.content,
          liveUrl: hermesDocsLiveUrl(result.path),
        })
      },
    },
  },
})
