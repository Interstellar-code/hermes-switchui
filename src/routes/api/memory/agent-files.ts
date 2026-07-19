/**
 * /api/memory/agent-files — CRUD for per-agent memory files.
 *
 * Path layout: $HERMES_HOME/profiles/<agent_id>/SOUL.md and memories/*.md.
 * MEMORY.md and USER.md live in memories/ but are exposed as flat UI tabs.
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
import { isAuthenticated } from '../../../server/auth-middleware'
import { requireJsonContentType } from '../../../server/rate-limit'
import { BUILTIN_AGENTS } from '../../../lib/builtin-agents'

const BUILTIN_AGENT_IDS = new Set(BUILTIN_AGENTS.map((a) => a.id))

function getHermesRoot(): string {
  const envHome = (process.env.HERMES_HOME ?? process.env.CLAUDE_HOME)?.trim()
  return envHome
    ? path.resolve(envHome)
    : path.resolve(path.join(os.homedir(), '.hermes'))
}

function getAgentProfileDir(agentId: string): string {
  return path.join(getHermesRoot(), 'profiles', agentId)
}

function resolveAgentFilePath(agentId: string, filename: string): string {
  const profileDir = getAgentProfileDir(agentId)
  return filename === 'SOUL.md'
    ? path.join(profileDir, filename)
    : path.join(profileDir, 'memories', filename)
}

function listAgentFiles(agentId: string): Array<AgentFileEntry> {
  const profileDir = getAgentProfileDir(agentId)
  const results: Array<AgentFileEntry> = []

  const soulPath = path.join(profileDir, 'SOUL.md')
  if (fs.existsSync(soulPath)) {
    const stat = fs.statSync(soulPath)
    results.push({
      filename: 'SOUL.md',
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    })
  }

  const memoriesDir = path.join(profileDir, 'memories')
  if (fs.existsSync(memoriesDir)) {
    for (const entry of fs.readdirSync(memoriesDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        const stat = fs.statSync(path.join(memoriesDir, entry.name))
        results.push({
          filename: entry.name,
          sizeBytes: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        })
      }
    }
  }

  const order = new Map(
    ['SOUL.md', 'MEMORY.md', 'USER.md'].map((name, index) => [name, index]),
  )
  return results.sort(
    (a, b) =>
      (order.get(a.filename) ?? order.size) -
        (order.get(b.filename) ?? order.size) ||
      a.filename.localeCompare(b.filename),
  )
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
  if (trimmed.includes('\\') || trimmed.includes('..'))
    throw new Error('Invalid filename')
  if (trimmed.includes('/')) throw new Error('Invalid filename')
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
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const url = new URL(request.url)
          const agentId = validateAgentId(url.searchParams.get('agent'))
          const filename = url.searchParams.get('filename')

          if (filename) {
            // Read single file
            const fname = validateFilename(filename)
            const fullPath = resolveAgentFilePath(agentId, fname)
            if (!fs.existsSync(fullPath)) {
              return Response.json({ error: 'File not found' }, { status: 404 })
            }
            const stat = fs.statSync(fullPath)
            const content = fs.readFileSync(fullPath, 'utf-8')
            return Response.json({
              agent: agentId,
              filename: fname,
              content,
              sizeBytes: stat.size,
              modifiedAt: stat.mtime.toISOString(),
            } satisfies AgentFileReadResponse)
          }

          // List files
          const files: Array<AgentFileEntry> = listAgentFiles(agentId)
          return Response.json({
            agent: agentId,
            files,
          } satisfies AgentFilesListResponse)
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Failed to list agent files'
          return Response.json({ error: message }, { status: 400 })
        }
      },

      // POST /api/memory/agent-files { agent, filename, content }
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
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
          const fullPath = resolveAgentFilePath(agentId, filename)
          fs.mkdirSync(path.dirname(fullPath), { recursive: true })
          fs.writeFileSync(fullPath, content, 'utf-8')
          return Response.json({ success: true, agent: agentId, filename })
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Failed to write agent file'
          const status = /required|invalid|\.md|unknown/i.test(message)
            ? 400
            : 500
          return Response.json({ error: message }, { status })
        }
      },

      // DELETE /api/memory/agent-files { agent, filename }
      DELETE: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
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
          const fullPath = resolveAgentFilePath(agentId, filename)
          if (!fs.existsSync(fullPath)) {
            return Response.json({ error: 'File not found' }, { status: 404 })
          }
          fs.unlinkSync(fullPath)
          return Response.json({ success: true, agent: agentId, filename })
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Failed to delete agent file'
          const status = /required|invalid|\.md|unknown/i.test(message)
            ? 400
            : 500
          return Response.json({ error: message }, { status })
        }
      },
    },
  },
})
