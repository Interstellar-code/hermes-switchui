/**
 * Aggregator for the social dashboard (`GET /api/dashboard/social`).
 *
 * Builds the `DashboardSocial` contract (C1) from existing sources —
 * nothing new is stored; every gamification number is derived (C2):
 *   XP       = 10·chat sessions + 25·workflow approvals + 40·tasks done
 *              + 5·workflow runs finished
 *   Level n  starts at 500·n·(n-1) XP
 *   Streak   = consecutive active days (session or workflow run, local
 *              day) ending today — or yesterday when today has none yet
 *   Badges   = the 12 fixed ones, earned iff have >= need
 *
 * Pattern follows `dashboard-aggregator.ts`: every upstream read goes
 * through a `safeJson`-style helper with a 4 s timeout and a failed
 * upstream nulls ONLY its slice, never the whole response.
 *
 * Profile scope (C3): `profile: null` = all profiles summed; a set
 * profile scopes every call via the dashboard `?profile=` mechanism
 * (the same one `getCronJobs` / `listExperiments` use).
 */

import type { DashboardFetcher } from './dashboard-aggregator'
import type {
  DashboardAgent,
  DashboardBadge,
  DashboardSocial,
  NeedsYouItem,
  RecentItem,
} from '../types/dashboard-social'

// ── Pure C2 helpers (exported so tests cover them without network) ──────────

/** XP weights from contract C2. */
export const XP_PER_CHAT = 10
export const XP_PER_APPROVAL = 25
export const XP_PER_TASK_DONE = 40
export const XP_PER_RUN_FINISHED = 5

export type XpInputs = {
  chatSessions: number
  approvals: number
  tasksDone: number
  runsFinished: number
}

/** XP = 10·chats + 25·approvals + 40·tasks done + 5·runs finished (C2). */
export function computeXp(inputs: XpInputs): number {
  return (
    XP_PER_CHAT * inputs.chatSessions +
    XP_PER_APPROVAL * inputs.approvals +
    XP_PER_TASK_DONE * inputs.tasksDone +
    XP_PER_RUN_FINISHED * inputs.runsFinished
  )
}

/** Level n starts at `500·n·(n-1)` XP (L1 0, L2 1000, L3 3000, …). */
export function levelStartXp(level: number): number {
  const n = Math.max(1, Math.floor(level))
  return 500 * n * (n - 1)
}

export type LevelInfo = {
  level: number
  levelStartXp: number
  nextLevelXp: number
}

/** Highest level whose start XP is <= xp, plus its bounds (C2). */
export function levelFor(xp: number): LevelInfo {
  const safeXp = Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0
  // Level 1 starts at 0, so this always terminates with level >= 1.
  let level = 1
  while (levelStartXp(level + 1) <= safeXp) level += 1
  return {
    level,
    levelStartXp: levelStartXp(level),
    nextLevelXp: levelStartXp(level + 1),
  }
}

/**
 * Streak of consecutive active days ending today — or ending yesterday
 * when today has no activity yet (C2). `days` are `YYYY-MM-DD` local
 * day keys; `today` is one such key.
 */
export function streakFrom(days: Array<string>, today: string): number {
  const active = new Set(days)
  const dayMs = (key: string): number => Date.parse(`${key}T00:00:00Z`)
  let cursor = dayMs(today)
  if (Number.isNaN(cursor)) return 0
  // Start counting from today when active, else from yesterday.
  if (!active.has(today)) cursor -= 86_400_000
  const keyFor = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
  let streak = 0
  while (active.has(keyFor(cursor))) {
    streak += 1
    cursor -= 86_400_000
  }
  return streak
}

/** Longest run of consecutive active days in `days` (best streak, C2). */
export function bestStreakFrom(days: Array<string>): number {
  const sorted = Array.from(new Set(days))
    .filter((d) => Number.isFinite(Date.parse(`${d}T00:00:00Z`)))
    .sort()
  let best = 0
  let run = 0
  let prev: number | null = null
  for (const day of sorted) {
    const ms = Date.parse(`${day}T00:00:00Z`)
    run = prev !== null && ms - prev === 86_400_000 ? run + 1 : 1
    prev = ms
    if (run > best) best = run
  }
  return best
}

/** Counters the fixed badge set derives from (mock.ts's 12 badges). */
export type BadgeInputs = {
  chatSessions: number
  approvals: number
  runsFinished: number
  memoryFacts: number
  profileCount: number
  releases: number
  selfImproveWins: number
  nightSessions: number
  maxWeekTokens: number
  streakDays: number
  bestStreak: number
  /** `YYYY-MM-DD` fallback for `earnedAt` when history cannot tell. */
  today: string
  /**
   * Best-effort "first day the badge held" per badge id, when day
   * history allows computing it. Absent ids fall back to `today`.
   */
  firstEarnedDay?: Record<string, string>
}

type BadgeSpec = {
  id: string
  name: string
  how: string
  need: number
  have: (input: BadgeInputs) => number
}

/** The 12 badges from the mockup, in mock order. */
const BADGE_SPECS: Array<BadgeSpec> = [
  {
    id: 'first-chat',
    name: 'First chat',
    how: 'day one',
    need: 1,
    have: (i) => i.chatSessions,
  },
  {
    id: 'streak-7',
    name: 'Streak 7',
    how: '7 days in a row',
    need: 7,
    have: (i) => i.streakDays,
  },
  {
    id: 'conductor',
    name: 'Conductor',
    how: '50 workflow runs',
    need: 50,
    have: (i) => i.runsFinished,
  },
  {
    id: 'gatekeeper',
    name: 'Gatekeeper',
    how: '10 approvals',
    need: 10,
    have: (i) => i.approvals,
  },
  {
    id: 'memory-keeper',
    name: 'Memory keeper',
    how: '100 facts saved',
    need: 100,
    have: (i) => i.memoryFacts,
  },
  {
    id: 'fleet',
    name: 'Fleet',
    how: '5 agent profiles',
    need: 5,
    have: (i) => i.profileCount,
  },
  {
    id: 'shipper',
    name: 'Shipper',
    how: '10 releases',
    need: 10,
    have: (i) => i.releases,
  },
  {
    id: 'self-made',
    name: 'Self-made',
    how: '10 self-improve wins',
    need: 10,
    have: (i) => i.selfImproveWins,
  },
  {
    id: 'night-owl',
    name: 'Night owl',
    how: '10 sessions after midnight',
    need: 10,
    have: (i) => i.nightSessions,
  },
  {
    id: 'token-whale',
    name: 'Token whale',
    how: '5M tokens in one week',
    need: 5_000_000,
    have: (i) => i.maxWeekTokens,
  },
  {
    id: 'maestro',
    name: 'Maestro',
    how: '200 workflow runs',
    need: 200,
    have: (i) => i.runsFinished,
  },
  {
    id: 'streak-30',
    name: 'Streak 30',
    how: '30 days in a row',
    need: 30,
    have: (i) => i.bestStreak,
  },
]

/**
 * The 12 badges with `have` from real counters. Earned iff
 * `have >= need`; `earnedAt` is the first day it held when history
 * could tell (`firstEarnedDay`), else `today` (documented fallback),
 * and `null` when not earned.
 */
export function badgeProgress(input: BadgeInputs): Array<DashboardBadge> {
  return BADGE_SPECS.map((spec) => {
    const have = Math.max(0, Math.floor(spec.have(input)))
    const earned = have >= spec.need
    const firstDay = input.firstEarnedDay?.[spec.id]
    return {
      id: spec.id,
      name: spec.name,
      how: spec.how,
      have,
      need: spec.need,
      earnedAt: earned
        ? Number.isFinite(Date.parse(`${firstDay ?? input.today}T00:00:00Z`))
          ? (firstDay ?? input.today)
          : input.today
        : null,
    }
  })
}

// ── Fetch plumbing (mirrors dashboard-aggregator's safeJson) ────────────────

const SOCIAL_FETCH_TIMEOUT_MS = 4_000

async function safeJson<T>(
  fetcher: DashboardFetcher,
  path: string,
): Promise<T | null> {
  try {
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`dashboard fetch timed out: ${path}`)),
        SOCIAL_FETCH_TIMEOUT_MS,
      )
    })
    const res = await Promise.race([fetcher(path), timeout])
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Epoch seconds or milliseconds → ms; null when unparseable. */
function toEpochMs(value: unknown): number | null {
  let n: number
  if (typeof value === 'number') n = value
  else if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  } else return null
  if (!Number.isFinite(n) || n <= 0) return null
  return n > 1e12 ? n : n * 1000
}

/** Local `YYYY-MM-DD` day key for a date (local-day per C2). */
function localDayKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** `YYYY-MM-DD` for an epoch-ms value in server-local time. */
function dayKeyFromMs(ms: number): string {
  return localDayKey(new Date(ms))
}

/** Append (or extend) `?profile=` on a dashboard path (C3 scope). */
function scoped(path: string, profile: string | null): string {
  if (!profile) return path
  return `${path}${path.includes('?') ? '&' : '?'}profile=${encodeURIComponent(profile)}`
}

// ── Raw payload shapes (defensive: everything through read* helpers) ────────

type SessionsPayload = {
  sessions?: Array<Record<string, unknown>>
  total?: number
  profile_totals?: Record<string, number>
  errors?: Array<{ profile: string; error: string }>
}

type AnalyticsPayload = {
  totals?: Record<string, unknown>
  daily?: Array<Record<string, unknown>>
}

type CronJobPayload = Record<string, unknown>

type WorkflowRunPayload = {
  runs?: Array<Record<string, unknown>>
}

type WorkflowDefinitionsPayload = {
  definitions?: Array<Record<string, unknown>>
}

type NodeRunsPayload = {
  nodeRuns?: Array<Record<string, unknown>>
}

type ExperimentsPayload = {
  experiments?: Array<Record<string, unknown>>
}

type AchievementsPayload = {
  achievements?: Array<Record<string, unknown>>
}

type RecentUnlocksPayload = {
  unlocks?: Array<Record<string, unknown>>
}

type MemoryActivityPayload = {
  days?: Array<{ date: string; count: number }>
  totals?: Record<string, number>
}

type StatusPayload = {
  profiles?: Array<string>
  hermes_home?: string
  gateways?: Array<{ profile?: string }>
  [key: string]: unknown
}

type HealthPayload = {
  status?: string
  gateway_state?: string
  active_agents?: number
  [key: string]: unknown
}

// ── Options ─────────────────────────────────────────────────────────────────

export type BuildSocialOptions = {
  /** Dashboard fetcher (tests stub it; the route wraps `dashboardFetch`). */
  fetcher: DashboardFetcher
  /** Gateway fetcher for `/health/detailed` (different host/port). */
  gatewayFetcher?: DashboardFetcher
  /** Selected profile; null = all profiles summed. */
  profile: string | null
  /** Injected clock for deterministic tests. */
  now?: Date
}

// ── Small derivations ───────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'from',
  'how',
  'i',
  'in',
  'into',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'that',
  'the',
  'to',
  'was',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'will',
  'with',
  'you',
  'your',
  'this',
  'these',
  'those',
  'me',
  'my',
  'we',
  'our',
  'us',
  'do',
  'does',
  'did',
  'done',
  'can',
  'could',
  'should',
  'would',
  'has',
  'have',
  'had',
  'not',
  'no',
  'so',
  'if',
  'then',
  'than',
  'too',
  'very',
  'just',
  'about',
  'over',
  'under',
  'up',
  'down',
  'out',
  'off',
  'again',
  'further',
  'once',
  'here',
  'there',
  'all',
  'any',
  'both',
  'each',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'own',
  'same',
  's',
  't',
  'don',
  'now',
  'chat',
  'session',
  'agent',
  'task',
])

function initialsFor(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, '')
  if (cleaned.length >= 2) return cleaned.slice(0, 2).toUpperCase()
  return (cleaned || 'AG').toUpperCase().slice(0, 2)
}

/**
 * Top words / project names from session titles in the last 7 days
 * (simple frequency, stop-words removed), max 5. `href` is `/chat`
 * (search is not wired yet).
 */
function computeHotTopics(
  sessions: Array<Record<string, unknown>>,
  now: Date,
): Array<{ label: string; href: string }> {
  const weekAgo = now.getTime() - 7 * 86_400_000
  const counts = new Map<string, number>()
  for (const row of sessions) {
    const started = toEpochMs(row.started_at)
    if (started === null || started < weekAgo) continue
    const title = readString(row.title)
    if (!title) continue
    for (const rawWord of title.split(/[^A-Za-z0-9]+/)) {
      const word = rawWord.toLowerCase()
      if (word.length < 3 || STOP_WORDS.has(word)) continue
      counts.set(word, (counts.get(word) ?? 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([label]) => ({ label, href: '/chat' }))
}

/** First `YYYY-MM-DD` (from sorted-asc epoch-ms dates) where the
 * cumulative count crosses `need` — the "first day it held". */
function firstDayCountReached(
  datesMs: Array<number>,
  need: number,
): string | null {
  if (need <= 0 || datesMs.length < need) return null
  const sorted = [...datesMs].sort((a, b) => a - b)
  return dayKeyFromMs(sorted[need - 1])
}

/** First day a streak of `len` consecutive days completed within the
 * active-day set, or null when history does not contain one. */
function firstDayStreakReached(
  days: Array<string>,
  len: number,
): string | null {
  const sorted = Array.from(new Set(days))
    .filter((d) => Number.isFinite(Date.parse(`${d}T00:00:00Z`)))
    .sort()
  let run = 0
  let prev: number | null = null
  for (const day of sorted) {
    const ms = Date.parse(`${day}T00:00:00Z`)
    run = prev !== null && ms - prev === 86_400_000 ? run + 1 : 1
    prev = ms
    if (run >= len) return day
  }
  return null
}

// ── Builder ─────────────────────────────────────────────────────────────────

export async function buildDashboardSocial(
  opts: BuildSocialOptions,
): Promise<DashboardSocial> {
  const { fetcher, profile } = opts
  const gatewayFetcher = opts.gatewayFetcher
  const now = opts.now ?? new Date()
  const todayKey = localDayKey(now)
  const weekAgoMs = now.getTime() - 7 * 86_400_000
  // Minutes east of UTC for the memory-activity local-day computation.
  const tzMinutes = -now.getTimezoneOffset()

  // Fans out every source in parallel; each nulls only its own slice.
  const [
    sessionsRaw,
    analyticsRaw,
    cronRaw,
    runsRaw,
    definitionsRaw,
    experimentsRaw,
    achievementsRaw,
    unlocksRaw,
    memoryRaw,
    statusRaw,
    healthRaw,
  ] = await Promise.all([
    safeJson<SessionsPayload>(
      fetcher,
      scoped('/api/profiles/sessions?limit=100', profile),
    ),
    safeJson<AnalyticsPayload>(
      fetcher,
      scoped('/api/analytics/usage?days=30', profile),
    ),
    safeJson<Array<CronJobPayload> | { jobs?: Array<CronJobPayload> }>(
      fetcher,
      scoped('/api/cron/jobs', profile),
    ),
    safeJson<WorkflowRunPayload>(
      fetcher,
      scoped('/api/plugins/workflow-engine/runs?limit=200', profile),
    ),
    safeJson<WorkflowDefinitionsPayload>(
      fetcher,
      scoped('/api/plugins/workflow-engine/definitions', profile),
    ),
    safeJson<ExperimentsPayload>(
      fetcher,
      scoped('/api/plugins/karpathy-self-improve/experiments', profile),
    ),
    safeJson<AchievementsPayload>(
      fetcher,
      scoped('/api/plugins/hermes-achievements/achievements', profile),
    ),
    safeJson<RecentUnlocksPayload>(
      fetcher,
      scoped(
        '/api/plugins/hermes-achievements/recent-unlocks?limit=5',
        profile,
      ),
    ),
    safeJson<MemoryActivityPayload>(
      fetcher,
      `/api/memory/activity?days=30&tz=${tzMinutes}${profile ? `&profile=${encodeURIComponent(profile)}` : ''}`,
    ),
    safeJson<StatusPayload>(fetcher, scoped('/api/status', profile)),
    gatewayFetcher
      ? safeJson<HealthPayload>(
          gatewayFetcher,
          scoped('/health/detailed', profile),
        )
      : Promise.resolve(null),
  ])

  // Cron payload is either a bare array or `{jobs: [...]}` (both shapes
  // appear across dashboard versions — normalizeCron does the same).
  const cronJobs: Array<CronJobPayload> = Array.isArray(cronRaw)
    ? cronRaw
    : Array.isArray(cronRaw?.jobs)
      ? cronRaw.jobs
      : []

  // ── Sessions ──────────────────────────────────────────────────────────
  const sessionRows = Array.isArray(sessionsRaw?.sessions)
    ? sessionsRaw.sessions
    : []
  const profileTotals = sessionsRaw?.profile_totals ?? {}
  const sessionsTotal =
    profile !== null
      ? readNumber(profileTotals[profile], readNumber(sessionsRaw?.total))
      : readNumber(sessionsRaw?.total)

  // ── Workflow runs ─────────────────────────────────────────────────────
  const runs = Array.isArray(runsRaw?.runs) ? runsRaw.runs : []
  const completedDatesMs: Array<number> = []
  let runsFinished = 0
  const runDayKeys: Array<string> = []
  const pausedRuns: Array<Record<string, unknown>> = []
  for (const run of runs) {
    const status = readString(run.status).toLowerCase()
    if (status === 'completed') {
      runsFinished += 1
      const done = toEpochMs(run.completed_at) ?? toEpochMs(run.started_at)
      if (done !== null) completedDatesMs.push(done)
    }
    const started = toEpochMs(run.started_at)
    if (started !== null) runDayKeys.push(dayKeyFromMs(started))
    if (status === 'paused') pausedRuns.push(run)
  }

  // Node runs for (a) paused runs → Needs You approvals, (b) the 10 most
  // recent runs → approval counting for XP/Gatekeeper. Capped so the
  // aggregate stays a bounded fan-out.
  const runsForNodes = Array.from(
    new Map(
      [
        ...pausedRuns,
        ...runs.slice(0, 10), // listRuns returns newest first
      ].map((run) => [readString(run.id), run]),
    ).values(),
  ).filter((run) => readString(run.id))
  const nodeRunsLists = await Promise.all(
    runsForNodes.map((run) =>
      safeJson<NodeRunsPayload>(
        fetcher,
        scoped(
          `/api/plugins/workflow-engine/runs/${encodeURIComponent(readString(run.id))}/nodes`,
          profile,
        ),
      ),
    ),
  )
  const nodesByRun = new Map<string, Array<Record<string, unknown>>>()
  nodeRunsLists.forEach((list, idx) => {
    const runId = readString(runsForNodes[idx].id)
    nodesByRun.set(runId, Array.isArray(list?.nodeRuns) ? list.nodeRuns : [])
  })

  let approvals = 0
  const approvalDatesMs: Array<number> = []
  for (const nodes of nodesByRun.values()) {
    for (const node of nodes) {
      // A recorded decision (approve or reject) on an approval node.
      const response = readOptionalString(node.approval_response)
      if (response) {
        approvals += 1
        const at = toEpochMs(node.completed_at)
        if (at !== null) approvalDatesMs.push(at)
      }
    }
  }

  // ── Workflow definitions (all-time run counts, versions, releases) ────
  const definitions = Array.isArray(definitionsRaw?.definitions)
    ? definitionsRaw.definitions
    : []
  const runsAllTime = definitions.reduce(
    (sum, def) => sum + readNumber(def.run_count),
    0,
  )
  // "Releases" proxy: finished runs of release-flavoured workflows. No
  // release-tag endpoint exists behind the dashboard fetcher, so Shipper
  // counts completed runs whose workflow id/name mentions release/deploy.
  const releaseRunDatesMs = runs
    .filter((run) => {
      const status = readString(run.status).toLowerCase()
      const target = `${readString(run.workflow_id)} ${readString(
        (run.metadata as Record<string, unknown> | null)?.workflow_name ?? '',
      )}`.toLowerCase()
      return status === 'completed' && /release|deploy|ship/.test(target)
    })
    .map((run) => toEpochMs(run.completed_at) ?? toEpochMs(run.started_at))
    .filter((ms): ms is number => ms !== null)
  const releases = releaseRunDatesMs.length

  // ── Kanban (dashboard plugin board powers /tasks) ──────────────────────
  const board = await safeJson<{
    board?: {
      columns?: Array<{ name?: string; tasks?: Array<Record<string, unknown>> }>
    }
  }>(fetcher, scoped('/api/plugins/kanban/board', profile))
  const tasks: Array<Record<string, unknown>> = []
  const tasksByStatus = new Map<string, Array<Record<string, unknown>>>()
  if (Array.isArray(board?.board?.columns)) {
    for (const column of board.board.columns) {
      const name = readString(column.name).toLowerCase() || 'unknown'
      const rows = Array.isArray(column.tasks) ? column.tasks : []
      tasksByStatus.set(name, [...(tasksByStatus.get(name) ?? []), ...rows])
      tasks.push(...rows)
    }
  }
  const doneTasks = tasksByStatus.get('done') ?? []
  const reviewTasks = tasksByStatus.get('review') ?? []
  const tasksDone = doneTasks.length

  // ── Memory ────────────────────────────────────────────────────────────
  const memoryDays = Array.isArray(memoryRaw?.days) ? memoryRaw.days : []
  const memoryFacts = readNumber(memoryRaw?.totals?.fact)

  // ── Self-improve (verified experiment = a win) ────────────────────────
  const experiments = Array.isArray(experimentsRaw?.experiments)
    ? experimentsRaw.experiments
    : []
  const selfImproveWins = experiments.filter(
    (exp) => readString(exp.state).toLowerCase() === 'verified',
  ).length

  // ── Achievements plugin (badge-unlock recents) ────────────────────────
  const unlocks = Array.isArray(unlocksRaw?.unlocks) ? unlocksRaw.unlocks : []

  // ── Profiles roster + per-agent rows ──────────────────────────────────
  const roster = new Set<string>()
  if (Array.isArray(statusRaw?.profiles)) {
    for (const name of statusRaw.profiles) {
      if (typeof name === 'string' && name) roster.add(name)
    }
  }
  for (const name of Object.keys(profileTotals)) roster.add(name)
  for (const row of sessionRows) {
    const name = readOptionalString(row.profile)
    if (name) roster.add(name)
  }

  const agents: Array<DashboardAgent> = []
  for (const id of roster) {
    const rows = sessionRows.filter((row) => readString(row.profile) === id)
    const tokensWeek = rows
      .filter((row) => {
        const at = toEpochMs(row.started_at) ?? toEpochMs(row.last_active)
        return at !== null && at >= weekAgoMs
      })
      .reduce(
        (sum, row) =>
          sum + readNumber(row.input_tokens) + readNumber(row.output_tokens),
        0,
      )
    const tasksWeek = doneTasks.filter((task) => {
      const at = toEpochMs(task.completed_at)
      return readString(task.assignee) === id && at !== null && at >= weekAgoMs
    }).length
    const runsWeek = runs.filter((run) => {
      const started = toEpochMs(run.started_at)
      return (
        started !== null &&
        started >= weekAgoMs &&
        readString(
          (run.metadata as Record<string, unknown> | null)?.profile ?? '',
        ) === id
      )
    }).length
    // "Working" heartbeat: a session for this profile touched in the
    // last 2 minutes (last_active / is_active on the fetched rows).
    const working = rows.some((row) => {
      if (row.is_active === true) return true
      const at = toEpochMs(row.last_active)
      return at !== null && now.getTime() - at <= 2 * 60_000
    })
    agents.push({
      id,
      initials: initialsFor(id),
      sessions: readNumber(profileTotals[id]),
      tokensWeek,
      tasksWeek,
      runsWeek,
      working,
      // No per-profile tool-name source exists behind the fetcher; the
      // column stays honest and empty rather than invented.
      topTools: [],
    })
  }

  // ── Active days / streaks (sessions via analytics daily + run days) ───
  const activeDaySet = new Set<string>(runDayKeys)
  if (Array.isArray(analyticsRaw?.daily)) {
    for (const day of analyticsRaw.daily) {
      const key = readString(day.day)
      if (key && readNumber(day.sessions) > 0) activeDaySet.add(key)
    }
  }
  const activeDays = Array.from(activeDaySet)
  const streakDays = streakFrom(activeDays, todayKey)
  const bestStreak = bestStreakFrom(activeDays)

  // This week's Mon..Sun activity flags for the operator card.
  const activeDaysWeek: Array<boolean> = []
  const monday = new Date(now)
  monday.setHours(0, 0, 0, 0)
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  for (let i = 0; i < 7; i += 1) {
    const key = localDayKey(new Date(monday.getTime() + i * 86_400_000))
    activeDaysWeek.push(activeDaySet.has(key))
  }

  // ── Night sessions / weekly token peak (from the fetched rows) ────────
  const nightSessions = sessionRows.filter((row) => {
    const at = toEpochMs(row.started_at)
    if (at === null) return false
    const hour = new Date(at).getHours()
    return hour >= 0 && hour < 5
  }).length
  const weekTokens = sessionRows
    .filter((row) => {
      const at = toEpochMs(row.started_at) ?? toEpochMs(row.last_active)
      return at !== null && at >= weekAgoMs
    })
    .reduce(
      (sum, row) =>
        sum + readNumber(row.input_tokens) + readNumber(row.output_tokens),
      0,
    )

  // ── XP / level / badges (C2 maths) ────────────────────────────────────
  const xp = computeXp({
    chatSessions: sessionsTotal,
    approvals,
    tasksDone,
    runsFinished,
  })
  const { level, levelStartXp: startXp, nextLevelXp } = levelFor(xp)

  const todayIso = `${todayKey}T00:00:00.000Z`
  const firstEarnedDay: Record<string, string> = {
    'first-chat':
      firstDayCountReached(
        sessionRows
          .map((row) => toEpochMs(row.started_at))
          .filter((ms): ms is number => ms !== null),
        1,
      ) ?? todayKey,
    'streak-7': firstDayStreakReached(activeDays, 7) ?? todayKey,
    'streak-30': firstDayStreakReached(activeDays, 30) ?? todayKey,
    conductor: firstDayCountReached(completedDatesMs, 50) ?? todayKey,
    maestro: firstDayCountReached(completedDatesMs, 200) ?? todayKey,
    gatekeeper: firstDayCountReached(approvalDatesMs, 10) ?? todayKey,
  }
  const badges = badgeProgress({
    chatSessions: sessionsTotal,
    approvals,
    runsFinished,
    memoryFacts,
    profileCount: roster.size,
    releases,
    selfImproveWins,
    nightSessions,
    maxWeekTokens: weekTokens,
    streakDays,
    bestStreak,
    today: todayKey,
    firstEarnedDay,
  })

  // ── Operator name: active profile when known ──────────────────────────
  const operatorName =
    profile ??
    readOptionalString(statusRaw?.gateways?.find((g) => g.profile)?.profile) ??
    (typeof statusRaw?.hermes_home === 'string' &&
    statusRaw.hermes_home.includes('/profiles/')
      ? statusRaw.hermes_home.split('/profiles/').pop()?.split('/')[0] || null
      : null) ??
    'operator'

  const operator =
    sessionsRaw !== null
      ? {
          name: operatorName,
          xp,
          level,
          levelStartXp: startXp,
          nextLevelXp,
          streakDays,
          bestStreak,
          activeDays: activeDaysWeek,
        }
      : null

  // ── Needs You ─────────────────────────────────────────────────────────
  const needsYou: Array<NeedsYouItem> = []

  if (runsRaw !== null) {
    for (const run of pausedRuns.slice(0, 5)) {
      const runId = readString(run.id)
      const nodes = nodesByRun.get(runId) ?? []
      const pausedNode =
        nodes.find(
          (node) => readString(node.status).toLowerCase() === 'paused',
        ) ?? null
      if (!pausedNode) continue
      const nodeRunId = readString(pausedNode.id)
      const completed = nodes.filter(
        (node) => readString(node.status).toLowerCase() === 'completed',
      ).length
      const pausedAt =
        toEpochMs(pausedNode.started_at) ?? toEpochMs(run.started_at)
      needsYou.push({
        kind: 'approval',
        runId,
        nodeRunId,
        workflow: readString(run.workflow_id),
        version: readString(
          (run.metadata as Record<string, unknown> | null)?.version,
        ),
        pausedAt:
          pausedAt !== null ? new Date(pausedAt).toISOString() : todayIso,
        progress: `${completed} of ${nodes.length} steps`,
        next:
          readOptionalString(pausedNode.approval_message) ??
          readString(pausedNode.dag_node_id),
        agent:
          readString(pausedNode.assigned_agent) ||
          readString(
            (run.metadata as Record<string, unknown> | null)?.profile,
          ) ||
          'workflow',
        at: pausedAt !== null ? new Date(pausedAt).toISOString() : todayIso,
      })
    }
  }

  if (cronRaw !== null) {
    for (const job of cronJobs) {
      const lastStatus = readString(job.last_status).toLowerCase()
      const lastError = readOptionalString(job.last_error)
      if (lastStatus !== 'error' && lastStatus !== 'failed' && !lastError) {
        continue
      }
      const lastRun = toEpochMs(job.last_run_at)
      needsYou.push({
        kind: 'cron-failing',
        jobId: readString(job.id) || readString(job.name) || 'unknown',
        name: readString(job.name) || readString(job.id) || 'unnamed job',
        // The cron payload exposes no failure counter — one recorded
        // failure state is the honest minimum.
        failures: 1,
        lastError: lastError ?? `last status: ${lastStatus || 'error'}`,
        agent: 'cron',
        at: lastRun !== null ? new Date(lastRun).toISOString() : todayIso,
      })
    }
  }

  if (board !== null) {
    for (const task of reviewTasks.slice(0, 5)) {
      const at = toEpochMs(task.updated_at) ?? toEpochMs(task.started_at)
      needsYou.push({
        kind: 'task-review',
        taskId: readString(task.id),
        title: readString(task.title) || 'untitled task',
        board: readString(task.tenant) || 'default',
        agent: readString(task.assignee) || 'unassigned',
        at: at !== null ? new Date(at).toISOString() : todayIso,
      })
    }
  }

  // ── Recent activity (newest 5 across sources) ─────────────────────────
  const recentCandidates: Array<RecentItem> = []

  if (sessionsRaw !== null) {
    for (const row of sessionRows.slice(0, 10)) {
      const at = toEpochMs(row.last_active) ?? toEpochMs(row.started_at)
      if (at === null) continue
      recentCandidates.push({
        at: new Date(at).toISOString(),
        kind: 'chat',
        title: readString(row.title) || 'untitled session',
        sub: `${readNumber(row.message_count)} messages`,
        who: readString(row.profile) || operatorName,
        href: '/chat',
      })
    }
  }
  if (runsRaw !== null) {
    for (const run of runs.slice(0, 10)) {
      const at = toEpochMs(run.started_at)
      if (at === null) continue
      const status = readString(run.status)
      recentCandidates.push({
        at: new Date(at).toISOString(),
        kind: 'workflow',
        title: `${readString(run.workflow_id)} ${status}`,
        sub: status === 'completed' ? 'run finished' : `run ${status}`,
        who:
          readString(
            (run.metadata as Record<string, unknown> | null)?.profile,
          ) || 'workflow',
        href: '/workflows',
      })
    }
  }
  if (cronRaw !== null) {
    for (const job of cronJobs) {
      const at = toEpochMs(job.last_run_at)
      if (at === null) continue
      const lastStatus = readString(job.last_status) || 'ran'
      recentCandidates.push({
        at: new Date(at).toISOString(),
        kind: 'cron',
        title: `${readString(job.name) || readString(job.id) || 'job'} ${lastStatus}`,
        sub: readOptionalString(job.last_error) ?? 'scheduled run',
        who: 'cron',
        href: '/jobs',
      })
    }
  }
  if (board !== null) {
    for (const task of tasks) {
      const at =
        toEpochMs(task.completed_at) ??
        toEpochMs(task.started_at) ??
        toEpochMs(task.updated_at)
      if (at === null) continue
      recentCandidates.push({
        at: new Date(at).toISOString(),
        kind: 'task',
        title: readString(task.title) || 'untitled task',
        sub: readString(task.status) || 'moved',
        who: readString(task.assignee) || 'unassigned',
        href: '/tasks',
      })
    }
  }
  if (memoryRaw !== null) {
    for (const day of [...memoryDays].reverse()) {
      if (readNumber(day.count) <= 0) continue
      recentCandidates.push({
        at: `${readString(day.date) || todayKey}T12:00:00.000Z`,
        kind: 'memory',
        title: `${readNumber(day.count)} memories saved`,
        sub: 'mnemosyne writes',
        who: operatorName,
        href: '/memory',
      })
    }
  }
  if (unlocksRaw !== null) {
    for (const unlock of unlocks) {
      const at = toEpochMs(unlock.unlocked_at)
      if (at === null) continue
      recentCandidates.push({
        at: new Date(at).toISOString(),
        kind: 'badge',
        title: `Badge earned: ${readString(unlock.name) || readString(unlock.id)}`,
        sub: readString(unlock.description),
        who: operatorName,
        href: '/dashboard',
      })
    }
  }
  const recent = recentCandidates
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 5)

  // ── Counts (null only when every contributing source failed) ─────────
  const gatewayOk =
    healthRaw !== null &&
    (readString(healthRaw.gateway_state).toLowerCase() === 'running' ||
      readString(healthRaw.status).toLowerCase() === 'ok' ||
      readNumber(healthRaw.active_agents) > 0)
  const sourcesOk = [
    sessionsRaw,
    analyticsRaw,
    cronRaw,
    runsRaw,
    board,
    memoryRaw,
    experimentsRaw,
  ].filter((raw) => raw !== null).length
  const counts =
    sourcesOk > 0
      ? {
          chats: sessionsTotal,
          needsYou: needsYou.length,
          workflows: runsAllTime > 0 ? runsAllTime : runs.length,
          cron: cronJobs.length,
          tasks: tasks.length,
          memory: memoryFacts,
          selfImprove: selfImproveWins,
          gatewayOk,
        }
      : null

  return {
    profile,
    generatedAt: now.toISOString(),
    operator,
    agents: roster.size > 0 || sessionsRaw !== null ? agents : null,
    hotTopics: sessionsRaw !== null ? computeHotTopics(sessionRows, now) : null,
    counts,
    needsYou:
      runsRaw !== null || cronRaw !== null || board !== null ? needsYou : null,
    recent,
    badges,
  }
}
