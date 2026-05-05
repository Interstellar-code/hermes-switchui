/**
 * GET /api/hermes-kanban/events-token
 *
 * Issues a short-lived one-time token the browser can use to open the
 * Workspace-owned Kanban event SSE stream at /api/hermes-kanban/events.
 *
 * The browser MUST NOT connect directly to the Agent dashboard WebSocket —
 * this endpoint hands off only a transient workspace session reference.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { randomUUID } from 'node:crypto'

// Simple in-memory one-time token store (per-process; not clustered).
// Token expires after 30 seconds.
const TOKEN_TTL_MS = 30_000
const tokens = new Map<string, number>() // token → expiry timestamp

export function issueEventToken(): string {
  const token = randomUUID()
  tokens.set(token, Date.now() + TOKEN_TTL_MS)
  // Prune expired tokens
  for (const [t, exp] of tokens) {
    if (exp < Date.now()) tokens.delete(t)
  }
  return token
}

export function consumeEventToken(token: string): boolean {
  const exp = tokens.get(token)
  if (!exp || exp < Date.now()) return false
  tokens.delete(token)
  return true
}

export const Route = createFileRoute('/api/hermes-kanban/events-token')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        const token = issueEventToken()
        return json({ token, ttl: TOKEN_TTL_MS / 1000 })
      },
    },
  },
})
