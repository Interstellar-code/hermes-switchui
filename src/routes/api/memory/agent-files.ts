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
import { BUILTIN_AGENTS } from '../../../lib/builtin-agents'

const BUILTIN_AGENT_IDS = new Set(BUILTIN_AGENTS.map((a) => a.id))

function getHermesRoot(): string {
  const envHome = (process.env.HERMES_HOME ?? process.env.CLAUDE_HOME)?.trim()
  return envHome
    ? path.resolve(envHome)
    : path.resolve(path.join(os.homedir(), '.hermes'))
}

// T1 Hermes Switch stores memory files directly at the Hermes root (~/.hermes/).
// T2 agents (neo/trinity/morpheus) use profiles/<id>/memory/ subdirectory.
function getAgentMemoryDir(agentId: string): string {
  if (agentId === 'hermes-switch') {
    return getHermesRoot()
  }
  return path.join(getHermesRoot(), 'profiles', agentId, 'memory')
}

// Resolve a (possibly subdir-prefixed) filename to an absolute path,
// verifying the result is inside the agent's base dir. Returns null if unsafe.
function resolveAgentFilePath(agentId: string, filename: string): string | null {
  const root = getHermesRoot()
  let base: string
  let rel: string
  if (agentId === 'hermes-switch') {
    base = root
    rel = filename // e.g. 'SOUL.md' or 'memories/MEMORY.md'
  } else {
    base = path.join(root, 'profiles', agentId, 'memory')
    rel = filename
  }
  const resolved = path.resolve(base, rel)
  if (!resolved.startsWith(base + path.sep) && resolved !== base) return null
  return resolved
}

// List all memory files for an agent. For T1 (hermes-switch) includes both
// root .md files and memories/*.md prefixed with 'memories/'.
function listAgentFiles(agentId: string): Array<AgentFileEntry> {
  const root = getHermesRoot()
  const results: Array<AgentFileEntry> = []

  if (agentId === 'hermes-switch') {
    // Root .md files
    if (fs.existsSync(root)) {
      const rootEntries = fs.readdirSync(root, { withFileTypes: true })
      for (const e of rootEntries) {
        if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
          const stat = fs.statSync(path.join(root, e.name))
          results.push({ filename: e.name, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() })
        }
      }
    }
    // memories/ subfolder
    const memoriesDir = path.join(root, 'memories')
    if (fs.existsSync(memoriesDir)) {
      const subEntries = fs.readdirSync(memoriesDir, { withFileTypes: true })
      for (const e of subEntries) {
        if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
          const stat = fs.statSync(path.join(memoriesDir, e.name))
          results.push({ filename: `memories/${e.name}`, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() })
        }
      }
    }
    return results.sort((a, b) => a.filename.localeCompare(b.filename))
  }

  // T2 agents
  const memDir = path.join(root, 'profiles', agentId, 'memory')
  if (!fs.existsSync(memDir)) return []
  const entries = fs.readdirSync(memDir, { withFileTypes: true })
  for (const e of entries) {
    if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
      const stat = fs.statSync(path.join(memDir, e.name))
      results.push({ filename: e.name, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() })
    }
  }
  return results.sort((a, b) => a.filename.localeCompare(b.filename))
}

function validateAgentId(id: unknown): string {
  if (typeof id !== 'string' || !id.trim()) throw new Error('agent is required')
  const trimmed = id.trim()
  if (!BUILTIN_AGENT_IDS.has(trimmed))
    throw new Error(`Unknown built-in agent: ${trimmed}`)
  return trimmed
}

const ALLOWED_SUBDIRS = new Set(['memories'])

function validateFilename(name: unknown, agentId?: string): string {
  if (typeof name !== 'string' || !name.trim())
    throw new Error('filename is required')
  const trimmed = name.trim()
  if (trimmed.includes('\\') || trimmed.includes('..'))
    throw new Error('Invalid filename')
  const slashCount = (trimmed.match(/\//g) ?? []).length
  if (slashCount > 1) throw new Error('Invalid filename')
  if (slashCount === 1) {
    const [dir, base] = trimmed.split('/')
    if (!ALLOWED_SUBDIRS.has(dir))
      throw new Error(`Subdirectory '${dir}' is not allowed`)
    if (agentId !== 'hermes-switch')
      throw new Error('Subdirectory filenames are only supported for hermes-switch')
    if (!base || base.includes('..') || !base.toLowerCase().endsWith('.md'))
      throw new Error('Invalid filename')
    return trimmed
  }
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

          if (filename) {
            // Read single file
            const fname = validateFilename(filename, agentId)
            const fullPath = resolveAgentFilePath(agentId, fname)
            if (!fullPath || !fs.existsSync(fullPath)) {
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
          const files: Array<AgentFileEntry> = listAgentFiles(agentId)
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
          const filename = validateFilename(body.filename, agentId)
          const content = typeof body.content === 'string' ? body.content : ''
          const fullPath = resolveAgentFilePath(agentId, filename)
          if (!fullPath) throw new Error('Invalid file path')
          fs.mkdirSync(path.dirname(fullPath), { recursive: true })
          fs.writeFileSync(fullPath, content, 'utf-8')
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
          const filename = validateFilename(body.filename, agentId)
          const fullPath = resolveAgentFilePath(agentId, filename)
          if (!fullPath) throw new Error('Invalid file path')
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
