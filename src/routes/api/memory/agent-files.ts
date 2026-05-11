/**
 * /api/memory/agent-files — CRUD for per-agent memory files.
 *
 * Path layout: $HERMES_HOME/profiles/<agent_id>/memory/*.md
 *
 * Rationale: ~/.hermes/agents/ does not exist on this install; profiles/<id>/
 * is the established per-agent directory already used by the profiles system.
 * The `memory/` sub-directory is new but safe — profiles-browser.ts never
 * touches it (it only reads config.yaml, .env, skills/, sessions/).
 *
 * Routes:
 *   GET    ?agent=<id>                  → list files for agent
 *   POST   { agent, filename, content } → create/overwrite file
 *   DELETE { agent, filename }          → delete file
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'

const BUILTIN_AGENT_IDS = new Set([
  'hermes-switch',
  'neo',
  'trinity',
  'morpheus',
])

function getHermesRoot(): string {
  const envHome = (process.env.HERMES_HOME ?? process.env.CLAUDE_HOME)?.trim()
  return envHome
    ? path.resolve(envHome)
    : path.resolve(path.join(os.homedir(), '.hermes'))
}

function getAgentMemoryDir(agentId: string): string {
  return path.join(getHermesRoot(), 'profiles', agentId, 'memory')
}

function validateAgentId(id: unknown): string {
  if (typeof id !== 'string' || !id.trim()) throw new Error('agent is required')
  const trimmed = id.trim()
  if (!BUILTIN_AGENT_IDS.has(trimmed))
    throw new Error(`Unknown built-in agent: ${trimmed}`)
  return trimmed
}

function validateFilename(name: unknown): string {
  if (typeof name !== 'string' || !name.trim())
    throw new Error('filename is required')
  const trimmed = name.trim()
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..'))
    throw new Error('Invalid filename')
  if (!trimmed.toLowerCase().endsWith('.md'))
    throw new Error('Only .md files are allowed')
  return trimmed
}

export type AgentFileEntry = {
  filename: string
  sizeBytes: number
  modifiedAt: string
}

export type AgentFilesListResponse = {
  agent: string
  files: Array<AgentFileEntry>
}

export type AgentFileReadResponse = {
  agent: string
  filename: string
  content: string
  sizeBytes: number
  modifiedAt: string
}

export const Route = createFileRoute('/api/memory/agent-files')({
  server: {
    handlers: {
      // GET /api/memory/agent-files?agent=<id>[&filename=<name>]
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const url = new URL(request.url)
          const agentId = validateAgentId(url.searchParams.get('agent'))
          const filename = url.searchParams.get('filename')
          const memDir = getAgentMemoryDir(agentId)

          if (filename) {
            // Read single file
            const fname = validateFilename(filename)
            const fullPath = path.join(memDir, fname)
            if (!fs.existsSync(fullPath)) {
              return json({ error: 'File not found' }, { status: 404 })
            }
            const stat = fs.statSync(fullPath)
            const content = fs.readFileSync(fullPath, 'utf-8')
            return json({
              agent: agentId,
              filename: fname,
              content,
              sizeBytes: stat.size,
              modifiedAt: stat.mtime.toISOString(),
            } satisfies AgentFileReadResponse)
          }

          // List files
          if (!fs.existsSync(memDir)) {
            return json({
              agent: agentId,
              files: [],
            } satisfies AgentFilesListResponse)
          }
          const entries = fs.readdirSync(memDir, { withFileTypes: true })
          const files: Array<AgentFileEntry> = entries
            .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md'))
            .map((e) => {
              const stat = fs.statSync(path.join(memDir, e.name))
              return {
                filename: e.name,
                sizeBytes: stat.size,
                modifiedAt: stat.mtime.toISOString(),
              }
            })
            .sort((a, b) => a.filename.localeCompare(b.filename))
          return json({ agent: agentId, files } satisfies AgentFilesListResponse)
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Failed to list agent files'
          return json({ error: message }, { status: 400 })
        }
      },

      // POST /api/memory/agent-files { agent, filename, content }
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        try {
          const body = (await request.json().catch(() => ({}))) as {
            agent?: unknown
            filename?: unknown
            content?: unknown
          }
          const agentId = validateAgentId(body.agent)
          const filename = validateFilename(body.filename)
          const content = typeof body.content === 'string' ? body.content : ''
          const memDir = getAgentMemoryDir(agentId)
          fs.mkdirSync(memDir, { recursive: true })
          fs.writeFileSync(path.join(memDir, filename), content, 'utf-8')
          return json({ success: true, agent: agentId, filename })
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Failed to write agent file'
          const status =
            /required|invalid|\.md|unknown/i.test(message) ? 400 : 500
          return json({ error: message }, { status })
        }
      },

      // DELETE /api/memory/agent-files { agent, filename }
      DELETE: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        try {
          const body = (await request.json().catch(() => ({}))) as {
            agent?: unknown
            filename?: unknown
          }
          const agentId = validateAgentId(body.agent)
          const filename = validateFilename(body.filename)
          const fullPath = path.join(getAgentMemoryDir(agentId), filename)
          if (!fs.existsSync(fullPath)) {
            return json({ error: 'File not found' }, { status: 404 })
          }
          fs.unlinkSync(fullPath)
          return json({ success: true, agent: agentId, filename })
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Failed to delete agent file'
          const status =
            /required|invalid|\.md|unknown/i.test(message) ? 400 : 500
          return json({ error: message }, { status })
        }
      },
    },
  },
})
