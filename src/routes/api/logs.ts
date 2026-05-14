import fs from 'node:fs/promises'
import { join } from 'node:path'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { getWorkspaceClaudeHome } from '../../server/claude-paths'
import {
  BEARER_TOKEN,
  CLAUDE_API,
  ensureGatewayProbed,
} from '../../server/gateway-capabilities'

function readPositiveInt(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function normalizeLogFile(value: string): 'agent' | 'gateway' {
  const normalized = value.trim().toLowerCase()
  return normalized === 'gateway' || normalized === 'gateway.log'
    ? 'gateway'
    : 'agent'
}

async function readLocalLogs(file: 'agent' | 'gateway', lines: number): Promise<Response | null> {
  const filename = file === 'gateway' ? 'gateway.log' : 'agent.log'
  const candidates = [
    join(getWorkspaceClaudeHome(), 'logs', filename),
    file === 'gateway' ? '/tmp/hermes-switchui-gateway.log' : '',
    file === 'gateway' ? '/tmp/hermes-workspace-gateway.log' : '',
  ].filter(Boolean)

  for (const path of candidates) {
    try {
      const raw = await fs.readFile(path, 'utf-8')
      const tail = raw
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-lines)
      return Response.json({
        file,
        source: 'local-fallback',
        path,
        lines: tail,
      })
    } catch {
      // try next candidate
    }
  }

  return null
}

export const Route = createFileRoute('/api/logs')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const capabilities = await ensureGatewayProbed()
        if (!capabilities.health && !capabilities.chatCompletions) {
          return json(
            { ok: false, error: 'Hermes gateway is unavailable.' },
            { status: 503 },
          )
        }

        const url = new URL(request.url)
        const file = normalizeLogFile(url.searchParams.get('file') || 'agent')
        const lines = readPositiveInt(url.searchParams.get('lines'), 120, 1, 500)
        const search = new URLSearchParams()
        search.set('lines', String(lines))
        search.set('file', file)

        const level = (url.searchParams.get('level') || '').trim()
        if (level) search.set('level', level)

        const component = (url.searchParams.get('component') || '').trim()
        if (component) search.set('component', component)

        const headers: Record<string, string> = {}
        if (BEARER_TOKEN) headers.Authorization = `Bearer ${BEARER_TOKEN}`

        let upstream: Response
        try {
          upstream = await fetch(`${CLAUDE_API}/api/logs?${search.toString()}`, {
            headers,
            signal: AbortSignal.timeout(5_000),
          })
        } catch (error) {
          return json(
            {
              ok: false,
              error:
                error instanceof Error ? error.message : 'Failed to reach Hermes logs API.',
            },
            { status: 502 },
          )
        }

        const contentType = upstream.headers.get('content-type') || 'application/json'
        const bodyText = await upstream.text()
        if (!upstream.ok) {
          if (upstream.status === 404 || upstream.status === 501) {
            const local = await readLocalLogs(file, lines)
            if (local) return local
          }
          return new Response(
            bodyText ||
              JSON.stringify({
                ok: false,
                error: `Hermes logs request failed (${upstream.status}).`,
              }),
            {
              status: upstream.status,
              headers: { 'content-type': contentType },
            },
          )
        }

        return new Response(bodyText, {
          status: upstream.status,
          headers: { 'content-type': contentType },
        })
      },
    },
  },
})
