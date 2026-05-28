import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { createFileRoute } from '@tanstack/react-router'
import * as yaml from 'yaml'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  BEARER_TOKEN,
  CLAUDE_API,
  ensureGatewayProbed,
} from '../../server/gateway-capabilities'
import {
  getClaudeRoot,
  getProfileClaudeHome,
  getWorkspaceClaudeHome,
} from '../../server/claude-paths'

type CrewDefinition = {
  id: string
  displayName: string
  role: string
  profilePath: string | null
}

type DbStats = {
  sessionCount: number
  messageCount: number
  toolCallCount: number
  totalTokens: number
  estimatedCostUsd: number | null
  lastSessionTitle: string | null
  lastSessionAt: number | null
}

type DelegatedActivity = {
  activeDelegatedSessionKey: string
  activeDelegatedParentSessionKey: string
  activeDelegatedTitle: string | null
  activeDelegatedLastActiveAt: number
}

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function buildCrewDefinitions(): Array<CrewDefinition> {
  const profilesDir = join(getClaudeRoot(), 'profiles')
  const dynamicProfiles = existsSync(profilesDir)
    ? readdirSync(profilesDir, { withFileTypes: true })
        .filter((entry) => {
          const profilePath = join(profilesDir, entry.name)
          if (entry.isDirectory()) return true
          if (!entry.isSymbolicLink()) return false
          try {
            return statSync(profilePath).isDirectory()
          } catch {
            return false
          }
        })
        .map((entry) => entry.name)
        .sort()
    : []

  return [
    {
      id: 'workspace',
      displayName: 'Workspace',
      role: 'Primary profile',
      profilePath: null,
    },
    ...dynamicProfiles.map((profile) => ({
      id: profile,
      displayName: titleCase(profile),
      role: 'Profile',
      profilePath: profile,
    })),
  ]
}

function getClaudeHome(profilePath: string | null): string {
  return profilePath
    ? getProfileClaudeHome(profilePath)
    : getWorkspaceClaudeHome()
}

function readGatewayState(claudeHome: string) {
  const path = join(claudeHome, 'gateway_state.json')
  if (!existsSync(path))
    return {
      pid: null,
      gatewayState: 'unknown',
      platforms: {},
      updatedAt: null,
    }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8'))
    return {
      pid: raw.pid ?? null,
      gatewayState: raw.gateway_state ?? 'unknown',
      platforms: raw.platforms ?? {},
      updatedAt: raw.updated_at ?? null,
    }
  } catch {
    return {
      pid: null,
      gatewayState: 'unknown',
      platforms: {},
      updatedAt: null,
    }
  }
}

function checkProcessAlive(pid: number | null): boolean {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readDbStats(claudeHome: string): DbStats {
  const dbPath = join(claudeHome, 'state.db')
  if (!existsSync(dbPath)) {
    return {
      sessionCount: 0,
      messageCount: 0,
      toolCallCount: 0,
      totalTokens: 0,
      estimatedCostUsd: null,
      lastSessionTitle: null,
      lastSessionAt: null,
    }
  }

  try {
    const script = `
import json, sqlite3, sys
path = sys.argv[1]
out = {
  "sessionCount": 0,
  "messageCount": 0,
  "toolCallCount": 0,
  "totalTokens": 0,
  "estimatedCostUsd": None,
  "lastSessionTitle": None,
  "lastSessionAt": None,
}
conn = sqlite3.connect(path)
conn.row_factory = sqlite3.Row
cur = conn.cursor()
has_sessions = cur.execute(
  "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sessions' LIMIT 1"
).fetchone()
if has_sessions is None:
  conn.close()
  print(json.dumps(out))
  raise SystemExit(0)
agg = cur.execute("""
SELECT
  COUNT(*) as session_count,
  COALESCE(SUM(message_count), 0) as total_messages,
  COALESCE(SUM(tool_call_count), 0) as total_tool_calls,
  COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0) as total_tokens,
  SUM(estimated_cost_usd) as estimated_cost,
  MAX(started_at) as last_session_at
FROM sessions
""").fetchone()
if agg is not None:
  out["sessionCount"] = agg["session_count"] or 0
  out["messageCount"] = agg["total_messages"] or 0
  out["toolCallCount"] = agg["total_tool_calls"] or 0
  out["totalTokens"] = agg["total_tokens"] or 0
  out["estimatedCostUsd"] = agg["estimated_cost"]
last_row = cur.execute("SELECT title, started_at FROM sessions ORDER BY started_at DESC LIMIT 1").fetchone()
if last_row is not None:
  out["lastSessionTitle"] = last_row["title"]
  out["lastSessionAt"] = last_row["started_at"]
conn.close()
print(json.dumps(out))
`
    const raw = execFileSync('python3', ['-c', script, dbPath], {
      encoding: 'utf-8',
      timeout: 3_000,
    })
    return JSON.parse(raw) as DbStats
  } catch {
    return {
      sessionCount: 0,
      messageCount: 0,
      toolCallCount: 0,
      totalTokens: 0,
      estimatedCostUsd: null,
      lastSessionTitle: null,
      lastSessionAt: null,
    }
  }
}

function readConfig(claudeHome: string): { model: string; provider: string } {
  const configPath = join(claudeHome, 'config.yaml')
  if (!existsSync(configPath)) return { model: 'unknown', provider: 'unknown' }
  try {
    const raw = yaml.parse(readFileSync(configPath, 'utf-8')) as Record<
      string,
      unknown
    >
    const modelVal = raw.model
    const providerVal = raw.provider

    if (typeof modelVal === 'object' && modelVal !== null) {
      const modelObj = modelVal as Record<string, unknown>
      return {
        model: String(modelObj.default ?? modelObj.name ?? 'unknown'),
        provider: String(modelObj.provider ?? providerVal ?? 'unknown'),
      }
    }

    return {
      model: String(modelVal ?? 'unknown'),
      provider: String(providerVal ?? 'unknown'),
    }
  } catch {
    return { model: 'unknown', provider: 'unknown' }
  }
}

function readCronJobCount(claudeHome: string): number {
  const cronPath = join(claudeHome, 'cron', 'jobs.json')
  if (!existsSync(cronPath)) return 0
  try {
    const jobs = JSON.parse(readFileSync(cronPath, 'utf-8'))
    return Array.isArray(jobs)
      ? jobs.length
      : typeof jobs === 'object' && jobs !== null
        ? Object.keys(jobs).length
        : 0
  } catch {
    return 0
  }
}

function readHermesSwitchDelegatedActivity(): Record<
  string,
  DelegatedActivity
> {
  const dbPath = join(getProfileClaudeHome('hermes-switch'), 'state.db')
  if (!existsSync(dbPath)) return {}

  try {
    const script = `
import json, re, sqlite3, sys, time

path = sys.argv[1]
cutoff = time.time() - 300
out = {}

def normalize_agent(value):
    value = (value or '').strip().lower()
    value = re.sub(r'[^a-z0-9_-]+', '-', value).strip('-')
    return value

def first_json_object(value):
    if not value:
        return None
    try:
        return json.loads(value)
    except Exception:
        return None

conn = sqlite3.connect(path)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

has_sessions = cur.execute(
  "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sessions' LIMIT 1"
).fetchone()
has_messages = cur.execute(
  "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'messages' LIMIT 1"
).fetchone()
if has_sessions is None or has_messages is None:
    conn.close()
    print(json.dumps(out))
    raise SystemExit(0)

goal_to_agent = {}
for row in cur.execute("SELECT tool_calls FROM messages WHERE tool_calls IS NOT NULL"):
    calls = first_json_object(row["tool_calls"])
    if not isinstance(calls, list):
        continue
    for call in calls:
        fn = call.get("function") if isinstance(call, dict) else None
        if not isinstance(fn, dict) or fn.get("name") != "delegate_task":
            continue
        args = first_json_object(fn.get("arguments"))
        if not isinstance(args, dict):
            continue
        goal = (args.get("goal") or "").strip()
        context = args.get("context") or ""
        match = re.search(r"\\byou\\s+are\\s+([A-Za-z0-9_-]+)\\b", context, re.I)
        if goal and match:
            goal_to_agent[goal] = normalize_agent(match.group(1))

fallback_keywords = [
    ("neo", ["gateway", "logs", "log", "errors", "warnings", "infra", "technical"]),
    ("trinity", ["finance", "financial", "market", "markets", "gold", "silver", "bitcoin", "ethereum", "crude"]),
    ("morpheus", ["website", "marketing", "positioning", "cta", "ctas", "messaging", "design"]),
]

children = cur.execute("""
SELECT
  s.id,
  s.parent_session_id,
  s.started_at,
  s.title,
  MAX(m.timestamp) AS last_active
FROM sessions s
LEFT JOIN messages m ON m.session_id = s.id
WHERE s.parent_session_id IS NOT NULL
  AND s.ended_at IS NULL
GROUP BY s.id
HAVING last_active IS NOT NULL AND last_active >= ?
ORDER BY last_active DESC
""", (cutoff,)).fetchall()

for child in children:
    first = cur.execute(
      "SELECT content FROM messages WHERE session_id = ? AND role = 'user' ORDER BY timestamp ASC, id ASC LIMIT 1",
      (child["id"],),
    ).fetchone()
    prompt = ((first["content"] if first else None) or "").strip()
    agent = goal_to_agent.get(prompt)
    if agent is None:
        lower = prompt.lower()
        best_agent = None
        best_score = 0
        for candidate, words in fallback_keywords:
            score = sum(1 for word in words if word in lower)
            if score > best_score:
                best_agent = candidate
                best_score = score
        agent = best_agent if best_score > 0 else None
    if not agent:
        continue

    current = out.get(agent)
    last_active = float(child["last_active"])
    if current and current["activeDelegatedLastActiveAt"] >= last_active:
        continue
    out[agent] = {
      "activeDelegatedSessionKey": child["id"],
      "activeDelegatedParentSessionKey": child["parent_session_id"],
      "activeDelegatedTitle": child["title"] or prompt[:180] or None,
      "activeDelegatedLastActiveAt": last_active,
    }

conn.close()
print(json.dumps(out))
`
    const raw = execFileSync('python3', ['-c', script, dbPath], {
      encoding: 'utf-8',
      timeout: 3_000,
    })
    return JSON.parse(raw) as Record<string, DelegatedActivity>
  } catch {
    return {}
  }
}

function emptyDelegatedActivity(): {
  activeDelegatedSessionKey: null
  activeDelegatedParentSessionKey: null
  activeDelegatedTitle: null
  activeDelegatedLastActiveAt: null
} {
  return {
    activeDelegatedSessionKey: null,
    activeDelegatedParentSessionKey: null,
    activeDelegatedTitle: null,
    activeDelegatedLastActiveAt: null,
  }
}

async function fetchAssignedTaskCounts(): Promise<Record<string, number>> {
  try {
    const res = await fetch(`${CLAUDE_API}/api/tasks?include_done=false`, {
      signal: AbortSignal.timeout(3_000),
      headers: BEARER_TOKEN ? { Authorization: `Bearer ${BEARER_TOKEN}` } : {},
    })
    if (!res.ok) return {}

    const data = (await res.json()) as {
      tasks?: Array<{ assignee?: string | null; column?: string | null }>
    }

    const counts: Record<string, number> = {}
    for (const task of data.tasks ?? []) {
      if (!task.assignee || task.column === 'done') continue
      counts[task.assignee] = (counts[task.assignee] ?? 0) + 1
    }
    return counts
  } catch {
    return {}
  }
}

export const Route = createFileRoute('/api/crew-status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        await ensureGatewayProbed()
        const taskCounts = await fetchAssignedTaskCounts()
        const crewDefinitions = buildCrewDefinitions()
        const delegatedActivity = readHermesSwitchDelegatedActivity()

        const crew = crewDefinitions.map((member) => {
          const claudeHome = getClaudeHome(member.profilePath)
          const profileFound = existsSync(claudeHome)
          const delegated =
            delegatedActivity[member.id] ?? emptyDelegatedActivity()

          if (!profileFound) {
            return {
              id: member.id,
              displayName: member.displayName,
              role: member.role,
              profileFound: false,
              gatewayState: 'unknown',
              processAlive: false,
              platforms: {},
              model: 'unknown',
              provider: 'unknown',
              lastSessionTitle: null,
              lastSessionAt: null,
              sessionCount: 0,
              messageCount: 0,
              toolCallCount: 0,
              totalTokens: 0,
              estimatedCostUsd: null,
              cronJobCount: 0,
              assignedTaskCount: taskCounts[member.id] ?? 0,
              ...delegated,
            }
          }

          const gatewayInfo = readGatewayState(claudeHome)
          const dbStats = readDbStats(claudeHome)
          const config = readConfig(claudeHome)

          return {
            id: member.id,
            displayName: member.displayName,
            role: member.role,
            profileFound: true,
            gatewayState: gatewayInfo.gatewayState,
            processAlive: checkProcessAlive(gatewayInfo.pid),
            platforms: gatewayInfo.platforms,
            model: config.model,
            provider: config.provider,
            lastSessionTitle: dbStats.lastSessionTitle,
            lastSessionAt: dbStats.lastSessionAt,
            sessionCount: dbStats.sessionCount,
            messageCount: dbStats.messageCount,
            toolCallCount: dbStats.toolCallCount,
            totalTokens: dbStats.totalTokens,
            estimatedCostUsd: dbStats.estimatedCostUsd,
            cronJobCount: readCronJobCount(claudeHome),
            assignedTaskCount: taskCounts[member.id] ?? 0,
            ...delegated,
          }
        })

        return Response.json({ crew, fetchedAt: Date.now() })
      },
    },
  },
})
