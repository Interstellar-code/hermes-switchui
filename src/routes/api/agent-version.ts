import { createFileRoute } from '@tanstack/react-router'
import { getAgentVersion } from '../../server/hermes-agent-version'

/**
 * `GET /api/agent-version` — the running agent's version string, or null.
 *
 * The read, its cache and its failure semantics live in
 * `server/hermes-agent-version.ts`, which is also what the slash-command
 * version floor (`server/hermes-slash-policy.ts`) consults. Sharing it is the
 * point: this route used to hold a private 60s cache with no invalidation, so
 * the sidebar badge and the exec gate could disagree about which build was
 * running for a minute after a restart. One cache, 10s, dropped on every
 * gateway re-probe.
 *
 * Unchanged for callers: `{ version: string }` or `{ version: null }`, always
 * 200 — the onboarding trust-boundary check and the sidebar badge both treat a
 * null as "could not tell" rather than an error.
 */
export const Route = createFileRoute('/api/agent-version')({
  server: {
    handlers: {
      GET: async () => Response.json({ version: await getAgentVersion() }),
    },
  },
})
