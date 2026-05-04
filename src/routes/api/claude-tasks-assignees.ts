/**
 * DEPRECATED: /api/claude-tasks-assignees
 *
 * This route now redirects to /api/hermes-kanban/assignees which is the
 * canonical source of normalized Agent Kanban assignee data.
 *
 * Kept as a 308 redirect for one release cycle so any external callers
 * are forwarded to the correct endpoint without breaking.
 */
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'

type RawAssignee = {
  id?: unknown
  name?: unknown
  label?: unknown
  isHuman?: unknown
  is_human?: unknown
}

type TaskAssignee = {
  id: string
  label: string
  isHuman: boolean
}

const CLAUDE_HOME = process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? path.join(os.homedir(), '.hermes')
const CONFIG_PATH = path.join(CLAUDE_HOME, 'config.yaml')
const PROFILES_PATH = path.join(CLAUDE_HOME, 'profiles')

function readConfig(): Record<string, unknown> {
  try {
    return (YAML.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>) ?? {}
  } catch {
    return {}
  }
}

function getProfileNames(): string[] {
  try {
    return fs.readdirSync(PROFILES_PATH).filter(name => {
      try {
        const profilePath = path.join(PROFILES_PATH, name)
        return (
          fs.statSync(profilePath).isDirectory() &&
          fs.existsSync(path.join(profilePath, 'config.yaml'))
        )
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
}

function authHeaders(): Record<string, string> {
  return BEARER_TOKEN ? { Authorization: `Bearer ${BEARER_TOKEN}` } : {}
}

function titleCaseProfile(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function normalizeAssigneePayload(payload: unknown, humanReviewer: string | null): Array<TaskAssignee> {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null
  const rawAssignees = Array.isArray(payload)
    ? payload
    : Array.isArray(record?.assignees)
      ? record.assignees
      : []

  const seen = new Set<string>()
  const assignees: Array<TaskAssignee> = []

  for (const raw of rawAssignees) {
    const item = typeof raw === 'string' ? { id: raw, label: raw } : raw as RawAssignee
    const id = typeof item.id === 'string'
      ? item.id
      : typeof item.name === 'string'
        ? item.name
        : null
    if (!id || seen.has(id)) continue
    seen.add(id)
    const label = typeof item.label === 'string' && item.label.trim().length > 0
      ? item.label
      : titleCaseProfile(id)
    assignees.push({
      id,
      label,
      isHuman: item.isHuman === true || item.is_human === true || id === humanReviewer,
    })
  }

  return assignees
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(2000),
      headers: authHeaders(),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export const Route = createFileRoute('/api/claude-tasks-assignees')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
        }
        // 308 Permanent Redirect — external callers follow and update their bookmarks
        return new Response(null, {
          status: 308,
          headers: { Location: '/api/hermes-kanban/assignees' },
        })
      },
    },
  },
})
