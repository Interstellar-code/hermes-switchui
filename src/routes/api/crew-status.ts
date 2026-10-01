import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { createFileRoute } from '@tanstack/react-router'
import * as yaml from 'yaml'
import { isAuthenticated } from '../../server/auth-middleware'
import { ensureGatewayProbed } from '../../server/gateway-capabilities'
import {
  getClaudeRoot,
  getProfileClaudeHome,
  getWorkspaceClaudeHome,
} from '../../server/claude-paths'
import {
  assignDelegatedSessions,
  emptyDelegatedAssignment,
} from '../../lib/crew-delegation'
import { getKanbanBoard } from '../../server/hermes-kanban-client'
import type { CrewActivity } from '../../lib/workspace-agents'
import type {
  CrewOwnActivity,
  DelegatedChildSession,
} from '../../lib/crew-delegation'

const execFileAsync = promisify(execFile)

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

function emptyDbStats(): DbStats {
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

type OwnActivityRead = CrewOwnActivity & {
  activity: CrewActivity | null
  liveSessions: Array<{ id: string; source: string | null }>
}

function emptyOwnActivity(): OwnActivityRead {
  return {
    isActive: false,
    activeSessionKey: null,
    activeSessionTitle: null,
    activeSessionLastActiveAt: null,
    activity: null,
    liveSessions: [],
  }
}

type StateDbBatch = {
  stats: Record<string, DbStats>
  own: Record<string, OwnActivityRead>
  delegated: Array<DelegatedChildSession>
}

/**
 * Every state.db read for one crew-status response, in ONE python process
 * (async, so the Node event loop keeps serving). Per profile:
 *  - stats: aggregate counters + last session;
 *  - own activity: active = any un-ended session with a message in the last
 *    180s; liveSessions = all such sessions (id + source) for the badges;
 *    activity = heartbeat description + newest assistant tool call of the
 *    active (else most recent) session. Tool args are redacted and only a
 *    command/url/query/path-like field is ever previewed.
 * Plus the hermes-switch db's active delegated child sessions: `delegate_task`
 * args carry NO agent identity, so they are surfaced unattributed and
 * assigned to avatars in `assignDelegatedSessions` (src/lib/crew-delegation.ts).
 * state.db is large: messages reads are `ORDER BY id DESC LIMIT 1` scoped to
 * one session. Read-only (`mode=ro`), SELECTs only, no schema writes; each
 * profile is isolated so one bad db doesn't blank the rest.
 */
const STATE_DB_BATCH_SCRIPT = `
import json, pathlib, re, sqlite3, sys, time

req = json.loads(sys.argv[1])
now = time.time()
cutoff = now - 180
out = {"stats": {}, "own": {}, "delegated": []}

def connect(path):
    conn = sqlite3.connect(pathlib.Path(path).as_uri() + "?mode=ro", uri=True, timeout=1)
    conn.row_factory = sqlite3.Row
    return conn

def has_table(cur, name):
    return cur.execute(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1", (name,)
    ).fetchone() is not None

REDACTIONS = [
    (re.compile(r"(?i)\\b(bearer|basic)\\s+[A-Za-z0-9._~+/=-]+"), r"\\1 [redacted]"),
    (re.compile(r"\\b(sk-[A-Za-z0-9_-]{6,}|ghp_[A-Za-z0-9]+|gho_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|xox[bp]-[A-Za-z0-9-]+)"), "[redacted]"),  # pragma: allowlist secret
    (re.compile(r"(?i)(\\"?[A-Za-z_]*(?:key|token|secret|password|passwd)\\"?\\s*:\\s*\\")[^\\"]*(\\")"), r"\\1[redacted]\\2"),
    (re.compile(r"(?i)\\b([A-Za-z_]*(?:key|token|secret|password|passwd|api_key))=\\S+"), r"\\1=[redacted]"),
    (re.compile(r"://[^/\\s:@]+:[^/\\s@]+@"), "://[redacted]@"),
]

def redact(text):
    for pattern, repl in REDACTIONS:
        text = pattern.sub(repl, text)
    return text

def compact(value, limit):
    text = " ".join(str(value).split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "\\u2026"

PREVIEW_KEYS = ("command", "cmd", "query", "q", "url", "path", "file_path", "file")

def preview_args(args):
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except Exception:
            return ""
    if isinstance(args, dict):
        for key in PREVIEW_KEYS:
            value = args.get(key)
            if isinstance(value, str) and value.strip():
                return compact(redact(value), 80)
    return ""

def read_stats(cur):
    stats = {"sessionCount": 0, "messageCount": 0, "toolCallCount": 0, "totalTokens": 0,
             "estimatedCostUsd": None, "lastSessionTitle": None, "lastSessionAt": None}
    if not has_table(cur, "sessions"):
        return stats
    agg = cur.execute("""
      SELECT COUNT(*) AS session_count,
        COALESCE(SUM(message_count), 0) AS total_messages,
        COALESCE(SUM(tool_call_count), 0) AS total_tool_calls,
        COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0) AS total_tokens,
        SUM(estimated_cost_usd) AS estimated_cost
      FROM sessions""").fetchone()
    if agg is not None:
        stats.update({"sessionCount": agg["session_count"] or 0, "messageCount": agg["total_messages"] or 0,
                      "toolCallCount": agg["total_tool_calls"] or 0, "totalTokens": agg["total_tokens"] or 0,
                      "estimatedCostUsd": agg["estimated_cost"]})
    last = cur.execute("SELECT title, started_at FROM sessions ORDER BY started_at DESC LIMIT 1").fetchone()
    if last is not None:
        stats["lastSessionTitle"] = last["title"]
        stats["lastSessionAt"] = last["started_at"]
    return stats

def read_own(cur):
    own = {"isActive": False, "activeSessionKey": None, "activeSessionTitle": None,
           "activeSessionLastActiveAt": None, "activity": None, "liveSessions": []}
    if not (has_table(cur, "sessions") and has_table(cur, "messages")):
        return own
    cols = {r[1] for r in cur.execute("PRAGMA table_info(sessions)")}
    ended = "WHERE s.ended_at IS NULL" if "ended_at" in cols else ""
    source = "s.source" if "source" in cols else "NULL"
    rows = cur.execute(f"""
      SELECT s.id, s.title, {source} AS source, MAX(m.timestamp) AS last_active
      FROM sessions s LEFT JOIN messages m ON m.session_id = s.id
      {ended}
      GROUP BY s.id
      HAVING last_active IS NOT NULL AND last_active >= ?
      ORDER BY last_active DESC LIMIT 50""", (cutoff,)).fetchall()
    own["liveSessions"] = [{"id": r["id"], "source": r["source"]} for r in rows]
    target = None
    if rows:
        row = rows[0]
        target = row["id"]
        own.update({"isActive": True, "activeSessionKey": row["id"], "activeSessionTitle": row["title"],
                    "activeSessionLastActiveAt": float(row["last_active"]) * 1000})
    elif "last_activity_at" in cols:
        recent = cur.execute(
          "SELECT id FROM sessions ORDER BY COALESCE(last_activity_at, started_at) DESC, started_at DESC LIMIT 1"
        ).fetchone()
        target = recent["id"] if recent else None
    if target is None:
        return own
    srow = cur.execute(
      "SELECT "
      + ("last_activity_description" if "last_activity_description" in cols else "NULL") + " AS descr, "
      + ("last_activity_at" if "last_activity_at" in cols else "NULL") + " AS at "
      + "FROM sessions WHERE id = ?", (target,)).fetchone()
    tool = None
    last_assistant = cur.execute(
      "SELECT tool_calls, timestamp FROM messages WHERE session_id = ? AND role = 'assistant' ORDER BY id DESC LIMIT 1",
      (target,)).fetchone()
    if last_assistant is not None and last_assistant["tool_calls"]:
        try:
            calls = json.loads(last_assistant["tool_calls"])
            if isinstance(calls, dict):
                calls = [calls]
            call = calls[-1] if calls else None
            fn = (call.get("function") or call) if isinstance(call, dict) else None
            if isinstance(fn, dict) and fn.get("name"):
                ts = last_assistant["timestamp"]
                tool = {"name": str(fn["name"]), "argsPreview": preview_args(fn.get("arguments")),
                        "at": float(ts) * 1000 if ts is not None else None}
        except Exception:
            tool = None
    stamps = [t for t in ((srow["at"] if srow else None), (rows[0]["last_active"] if rows else None)) if t is not None]
    descr = ((srow["descr"] or "").strip() if srow else "")
    own["activity"] = {"sessionKey": target, "description": descr or None,
                       "at": float(max(stamps)) * 1000 if stamps else None, "tool": tool}
    return own

def read_delegated(cur):
    result = []
    if not (has_table(cur, "sessions") and has_table(cur, "messages")):
        return result
    cols = {r[1] for r in cur.execute("PRAGMA table_info(sessions)")}
    ended = "AND s.ended_at IS NULL" if "ended_at" in cols else ""
    children = cur.execute(f"""
      SELECT s.id, s.parent_session_id, s.title, s.started_at, MAX(m.timestamp) AS last_active
      FROM sessions s LEFT JOIN messages m ON m.session_id = s.id
      WHERE s.parent_session_id IS NOT NULL {ended}
      GROUP BY s.id
      HAVING (last_active IS NOT NULL AND last_active >= ?)
          OR (last_active IS NULL AND s.started_at >= ?)
      ORDER BY COALESCE(last_active, s.started_at) DESC""", (cutoff, cutoff)).fetchall()
    for child in children:
        title = child["title"]
        if not title:
            first = cur.execute(
              "SELECT content FROM messages WHERE session_id = ? AND role = 'user' ORDER BY timestamp ASC, id ASC LIMIT 1",
              (child["id"],)).fetchone()
            title = (((first["content"] if first else None) or "").strip())[:140] or None
        raw_ts = child["last_active"] if child["last_active"] is not None else child["started_at"]
        result.append({"sessionKey": child["id"], "parentSessionKey": child["parent_session_id"],
                       "title": title, "lastActiveAt": float(raw_ts) * 1000})
    return result

for entry in req["profiles"]:
    try:
        conn = connect(entry["path"])
        try:
            cur = conn.cursor()
            out["stats"][entry["id"]] = read_stats(cur)
            out["own"][entry["id"]] = read_own(cur)
        finally:
            conn.close()
    except Exception:
        pass

if req.get("delegatedPath"):
    try:
        conn = connect(req["delegatedPath"])
        try:
            out["delegated"] = read_delegated(conn.cursor())
        finally:
            conn.close()
    except Exception:
        pass

print(json.dumps(out))
`

async function readStateDbs(
  profiles: Array<{ id: string; path: string }>,
  delegatedPath: string | null,
): Promise<StateDbBatch> {
  const empty: StateDbBatch = { stats: {}, own: {}, delegated: [] }
  if (profiles.length === 0 && !delegatedPath) return empty
  try {
    const { stdout } = await execFileAsync(
      'python3',
      [
        '-c',
        STATE_DB_BATCH_SCRIPT,
        JSON.stringify({ profiles, delegatedPath }),
      ],
      { encoding: 'utf-8', timeout: 5_000 },
    )
    const parsed = JSON.parse(stdout) as Partial<StateDbBatch>
    return {
      stats: parsed.stats ?? {},
      own: parsed.own ?? {},
      delegated: Array.isArray(parsed.delegated) ? parsed.delegated : [],
    }
  } catch {
    return empty
  }
}

async function fetchAssignedTaskCounts(): Promise<Record<string, number>> {
  try {
    const board = await getKanbanBoard()
    const counts: Record<string, number> = {}

    for (const column of board.columns) {
      if (column.name === 'done' || column.name === 'archived') continue
      for (const task of column.tasks) {
        if (!task.assignee) continue
        counts[task.assignee] = (counts[task.assignee] ?? 0) + 1
      }
    }

    return counts
  } catch {
    return {}
  }
}

async function buildCrewStatus() {
  await ensureGatewayProbed()
  const taskCounts = await fetchAssignedTaskCounts()
  const crewDefinitions = buildCrewDefinitions()

  // Anonymous delegated child sessions live in the hermes-switch profile's
  // own db. Read them once, plus each profile's own-db live activity, then
  // deterministically round-robin the delegated sessions across tier-2
  // avatars (see src/lib/crew-delegation.ts).
  const dbs = await readStateDbs(
    crewDefinitions.flatMap((member) => {
      const path = join(getClaudeHome(member.profilePath), 'state.db')
      return existsSync(path) ? [{ id: member.id, path }] : []
    }),
    (() => {
      const path = join(getProfileClaudeHome('hermes-switch'), 'state.db')
      return existsSync(path) ? path : null
    })(),
  )
  const delegatedSessions = dbs.delegated
  const ownActivity: Record<string, OwnActivityRead> = {}
  for (const member of crewDefinitions) {
    ownActivity[member.id] = {
      ...emptyOwnActivity(),
      ...dbs.own[member.id],
    }
  }

  const delegatedAssignments = assignDelegatedSessions(
    crewDefinitions.map((member) => member.id),
    delegatedSessions,
    ownActivity,
  )

  const crew = crewDefinitions.map((member) => {
    const claudeHome = getClaudeHome(member.profilePath)
    const profileFound = existsSync(claudeHome)
    const own = ownActivity[member.id]
    const delegated =
      delegatedAssignments[member.id] ?? emptyDelegatedAssignment()

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
        isActive: own.isActive,
        activeSessionKey: own.activeSessionKey,
        activeSessionTitle: own.activeSessionTitle,
        activeSessionLastActiveAt: own.activeSessionLastActiveAt,
        activity: own.activity,
        liveSessions: own.liveSessions,
        ...delegated,
      }
    }

    const gatewayInfo = readGatewayState(claudeHome)
    const dbStats = dbs.stats[member.id] ?? emptyDbStats()
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
      isActive: own.isActive,
      activeSessionKey: own.activeSessionKey,
      activeSessionTitle: own.activeSessionTitle,
      activeSessionLastActiveAt: own.activeSessionLastActiveAt,
      activity: own.activity,
      liveSessions: own.liveSessions,
      ...delegated,
    }
  })

  return {
    crew,
    delegatedSessions,
    fetchedAt: Date.now(),
  }
}

type CrewStatusBody = Awaited<ReturnType<typeof buildCrewStatus>>

// The page polls every 3s and several tabs/queries may ask at once: reuse a
// result for 2.5s and share one in-flight build. Keyed by the hermes root so a
// changed HERMES_HOME (or a test fixture) never gets another root's data.
const CACHE_TTL_MS = 2_500
let cache: {
  key: string
  /** When the build settled; null while in flight (always shared). */
  settledAt: number | null
  promise: Promise<CrewStatusBody>
} | null = null

function getCrewStatusCached(): Promise<CrewStatusBody> {
  const key = getClaudeRoot()
  if (
    cache &&
    cache.key === key &&
    (cache.settledAt === null || Date.now() - cache.settledAt < CACHE_TTL_MS)
  ) {
    return cache.promise
  }
  const entry: NonNullable<typeof cache> = {
    key,
    settledAt: null,
    promise: buildCrewStatus(),
  }
  cache = entry
  entry.promise.then(
    () => {
      entry.settledAt = Date.now()
    },
    () => {
      // A failed build must not be served for the TTL.
      if (cache === entry) cache = null
    },
  )
  return entry.promise
}

export const Route = createFileRoute('/api/crew-status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await getCrewStatusCached()
        return Response.json(body)
      },
    },
  },
})
