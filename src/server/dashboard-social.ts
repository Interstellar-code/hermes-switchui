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
 * through a `safeJson`-style helper with an 8 s timeout and a failed
 * upstream nulls ONLY its slice, never the whole response.
 *
 * Profile scope (C3): `?profile=` is appended ONLY to upstreams this
 * repo proves honour it (sessions, cron, self-improve experiments,
 * mnemosyne memory). Upstreams with no profile dimension in their
 * typed contracts (workflow engine, kanban board, achievements,
 * analytics, /api/status, gateway health) are called unscoped and are
 * fleet/workspace-wide by construction — see the PROFILE SCOPE notes
 * on each fetch below. `profile: null` sums the per-profile sources by
 * fanning them out over the profile roster.
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
  /**
   * First `YYYY-MM-DD` the badge provably held, per badge id, when the
   * day history contains the crossing. Emitted as a full ISO timestamp.
   */
  firstEarnedDay?: Record<string, string>
  /**
   * Earliest `YYYY-MM-DD` covered by any evidence (rows, runs, unlocks).
   * Used for earned badges whose crossing the windowed history cannot
   * show: with all-time counters, the badge had already been earned by
   * this date, so it is the earliest date the evidence can assert.
   */
  earliestKnown?: string | null
  /**
   * Measurement day, `YYYY-MM-DD`. Last-resort `earnedAt` for earned
   * badges with NO date-bearing evidence at all (C1 types `earnedAt:
   * string | null` with null meaning unearned, so an earned badge must
   * carry a date). B3 must not render this as "earned today" — see the
   * lane report.
   */
  today: string
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

function isoDay(day: string | null | undefined): string | null {
  if (!day || !Number.isFinite(Date.parse(`${day}T00:00:00Z`))) return null
  return `${day}T00:00:00.000Z`
}

/**
 * The 12 badges with `have` from real counters. Earned iff
 * `have >= need`; `earnedAt` (full ISO) is the first day it held when
 * history can tell (`firstEarnedDay`), else the earliest day the
 * evidence covers (`earliestKnown` — an upper bound on the true earn
 * date), else the measurement day (`today`) — null only when unearned.
 */
export function badgeProgress(input: BadgeInputs): Array<DashboardBadge> {
  return BADGE_SPECS.map((spec) => {
    const have = Math.max(0, Math.floor(spec.have(input)))
    const earned = have >= spec.need
    return {
      id: spec.id,
      name: spec.name,
      how: spec.how,
      have,
      need: spec.need,
      earnedAt: earned
        ? isoDay(
            input.firstEarnedDay?.[spec.id] ??
              input.earliestKnown ??
              input.today,
          )
        : null,
    }
  })
}

// ── Fetch plumbing (mirrors dashboard-aggregator's safeJson) ────────────────

// 8 s (QA follow-up #1): a cold dev server answers some upstreams in
// 5–7 s; at 4 s those slices came back null.
const SOCIAL_FETCH_TIMEOUT_MS = 8_000

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

/** Append (or extend) `?profile=` on a path whose upstream honours it. */
function scoped(path: string, profile: string): string {
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

type BoardPayload = {
  board?: {
    columns?: Array<{
      name?: string
      tasks?: Array<Record<string, unknown>>
    }>
  }
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
  // QA follow-up #4: common verbs/adverbs that survived the first cut.
  'only',
  'run',
  'runs',
  'work',
  'make',
  'need',
  'also',
  'check',
  'using',
  'used',
  'been',
])

function initialsFor(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, '')
  if (cleaned.length >= 2) return cleaned.slice(0, 2).toUpperCase()
  return (cleaned || 'AG').toUpperCase().slice(0, 2)
}

/**
 * Hex/uuid-like token (QA follow-up #4): pure hex with ≥ 6 chars, or a
 * digits+letters mix with ≥ 6 hex chars — ids and hashes, not topics.
 * Project-like words (`mnemosyne`, `workflows`) stay: they either have
 * no digits or not enough hex characters.
 */
function isHexLikeToken(word: string): boolean {
  if (/^[0-9a-f]{6,}$/i.test(word)) return true
  if (!/\d/.test(word) || !/[a-z]/.test(word)) return false
  return (word.match(/[0-9a-f]/gi) ?? []).length >= 6
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
      // QA follow-up #4: < 4 chars, stop-words, pure numbers and
      // hex/uuid-like ids are not topics.
      if (word.length < 4 || STOP_WORDS.has(word)) continue
      if (/^\d+$/.test(word) || isHexLikeToken(word)) continue
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

/** Highest 7-day token total across `analytics.daily` (input+output). */
function maxWeekTokensFromDaily(daily: Array<Record<string, unknown>>): number {
  const byDay = new Map<string, number>()
  for (const entry of daily) {
    const day = readString(entry.day)
    if (!day) continue
    const tokens =
      readNumber(entry.input_tokens) + readNumber(entry.output_tokens)
    byDay.set(day, (byDay.get(day) ?? 0) + tokens)
  }
  const days = Array.from(byDay.keys())
    .filter((d) => Number.isFinite(Date.parse(`${d}T00:00:00Z`)))
    .sort()
  let max = 0
  for (let i = 0; i < days.length; i += 1) {
    let week = 0
    for (let j = i; j < days.length; j += 1) {
      if (
        Date.parse(`${days[j]}T00:00:00Z`) -
          Date.parse(`${days[i]}T00:00:00Z`) >=
        7 * 86_400_000
      ) {
        break
      }
      week += byDay.get(days[j]) ?? 0
    }
    if (week > max) max = week
  }
  return max
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

  // ── Phase 1: profile-independent fan-out ───────────────────────────────
  //
  // PROFILE SCOPE, per upstream (proof in repo callers / typed contracts):
  //  - /api/profiles/sessions  honours ?profile= (claude-dashboard-api.ts:246)
  //  - /api/status             no profile dimension (topology: profiles list)
  //  - /api/analytics/usage    no profile param anywhere (getAnalytics,
  //                            claude-dashboard-api.ts:564) — active-profile
  //                            view; only used for profile=null slices
  //  - workflow-engine plugin  WorkflowRun/WorkflowDefinitionRow carry no
  //                            profile field (workflow-engine/interface.ts)
  //                            — fleet-wide; a set profile EXCLUDES its
  //                            data from XP, counts.workflows, streak and
  //                            needsYou approvals (see runsInScope)
  //  - kanban board plugin     no profile param (hermes-kanban-client.ts);
  //                            the assignee is the per-profile key, so a
  //                            set profile filters tasks by assignee
  //  - achievements plugin     same aggregator path as overview, global
  //  - /health/detailed        gateway runtime state, not profile data
  const [
    sessionsRaw,
    statusRaw,
    analyticsRaw,
    runsRaw,
    definitionsRaw,
    boardRaw,
    achievementsRaw,
    unlocksRaw,
    healthRaw,
  ] = await Promise.all([
    safeJson<SessionsPayload>(
      fetcher,
      profile
        ? scoped('/api/profiles/sessions?limit=100', profile)
        : '/api/profiles/sessions?limit=100',
    ),
    safeJson<StatusPayload>(fetcher, '/api/status'),
    safeJson<AnalyticsPayload>(fetcher, '/api/analytics/usage?days=30'),
    safeJson<WorkflowRunPayload>(
      fetcher,
      '/api/plugins/workflow-engine/runs?limit=200',
    ),
    safeJson<WorkflowDefinitionsPayload>(
      fetcher,
      '/api/plugins/workflow-engine/definitions',
    ),
    safeJson<BoardPayload>(fetcher, '/api/plugins/kanban/board'),
    safeJson<AchievementsPayload>(
      fetcher,
      '/api/plugins/hermes-achievements/achievements',
    ),
    safeJson<RecentUnlocksPayload>(
      fetcher,
      '/api/plugins/hermes-achievements/recent-unlocks?limit=5',
    ),
    gatewayFetcher
      ? safeJson<HealthPayload>(gatewayFetcher, '/health/detailed')
      : Promise.resolve(null),
  ])

  // ── Roster (fleet list — topology, not per-profile activity) ───────────
  const sessionRows = Array.isArray(sessionsRaw?.sessions)
    ? sessionsRaw.sessions
    : []
  const profileTotals = sessionsRaw?.profile_totals ?? {}
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
  const rosterList = Array.from(roster)

  // ── Phase 2: per-profile sources ───────────────────────────────────────
  //
  // All three honours ?profile= (cron: claude-dashboard-api.ts:523,
  // self-improve: self-improve-client.ts:67,112, memory:
  // mnemosyne-browser.ts:788-792). For profile=null they are fanned out
  // over the roster and summed, so "all profiles" never silently means
  // "the active profile"; with no roster to fan out over, a single
  // unscoped call is the dashboard default (disclosed here).
  const fanOutProfiles: Array<string | null> = profile
    ? [profile]
    : rosterList.length > 0
      ? rosterList
      : [null]
  const [cronLists, experimentsLists, memoryLists] = await Promise.all([
    Promise.all(
      fanOutProfiles.map((p) =>
        safeJson<Array<CronJobPayload> | { jobs?: Array<CronJobPayload> }>(
          fetcher,
          p ? scoped('/api/cron/jobs', p) : '/api/cron/jobs',
        ),
      ),
    ),
    Promise.all(
      fanOutProfiles.map((p) =>
        safeJson<ExperimentsPayload>(
          fetcher,
          p
            ? scoped('/api/plugins/karpathy-self-improve/experiments', p)
            : '/api/plugins/karpathy-self-improve/experiments',
        ),
      ),
    ),
    Promise.all(
      fanOutProfiles.map((p) =>
        safeJson<MemoryActivityPayload>(
          fetcher,
          `/api/memory/activity?days=30&tz=${tzMinutes}${p ? `&profile=${encodeURIComponent(p)}` : ''}`,
        ),
      ),
    ),
  ])

  const cronJobs: Array<CronJobPayload> = []
  let cronOk = false
  for (const list of cronLists) {
    if (list === null) continue
    cronOk = true
    if (Array.isArray(list)) cronJobs.push(...list)
    else if (Array.isArray(list.jobs)) cronJobs.push(...list.jobs)
  }
  const experiments: Array<Record<string, unknown>> = []
  let experimentsOk = false
  for (const list of experimentsLists) {
    if (list === null) continue
    experimentsOk = true
    if (Array.isArray(list.experiments)) experiments.push(...list.experiments)
  }
  const memoryDaysByDate = new Map<string, number>()
  let memoryFacts = 0
  let memoryOk = false
  for (const list of memoryLists) {
    if (list === null) continue
    memoryOk = true
    memoryFacts += readNumber(list.totals?.fact)
    for (const day of Array.isArray(list.days) ? list.days : []) {
      memoryDaysByDate.set(
        day.date,
        (memoryDaysByDate.get(day.date) ?? 0) + readNumber(day.count),
      )
    }
  }
  const memoryDays = Array.from(memoryDaysByDate.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date))

  // ── Sessions counts: scoped, never a global fallback (#4) ─────────────
  const sessionsTotal =
    profile !== null
      ? readNumber(profileTotals[profile], 0)
      : readNumber(sessionsRaw?.total)

  // Workflow runs/approvals/run_count are only usable fleet-wide.
  const runsInScope = profile === null

  // ── Workflow runs (shared engine; only real WorkflowRun fields) ───────
  const runs = Array.isArray(runsRaw?.runs) ? runsRaw.runs : []
  const defByName = new Map<string, { name: string; version: string }>()
  const definitions = Array.isArray(definitionsRaw?.definitions)
    ? definitionsRaw.definitions
    : []
  for (const def of definitions) {
    const id = readString(def.id)
    if (!id) continue
    defByName.set(id, {
      name: readString(def.name) || id,
      version: readString(def.version),
    })
  }
  const workflowLabel = (run: Record<string, unknown>): string => {
    const id = readString(run.workflow_id)
    return defByName.get(id)?.name ?? id
  }

  const pausedRuns: Array<Record<string, unknown>> = []
  const runDayKeys: Array<string> = []
  for (const run of runs) {
    const status = readString(run.status).toLowerCase()
    if (status === 'paused') pausedRuns.push(run)
    const started = toEpochMs(run.started_at)
    // workflow engine has no per-profile data; profile view excludes it
    if (runsInScope && started !== null) runDayKeys.push(dayKeyFromMs(started))
  }

  // Node runs for (a) the 5 newest paused runs → Needs You approvals,
  // (b) the 10 most recent runs → approval counting for XP/Gatekeeper.
  // Approvals are the single operator's recorded decisions
  // (workflow-runs.$runId.approve.ts sets approved_by='switchui'), so
  // they are fleet-wide facts, not per-profile data.
  // APPROVAL WINDOW: approvals are counted only over the node runs of
  // these 10 most recent runs (bounded fan-out); older approvals age
  // out of the count. Runs-finished uses the all-time definition
  // run_count below, so XP's largest terms stay monotonic.
  // workflow engine has no per-profile data; profile view excludes it
  const runsForNodes = runsInScope
    ? Array.from(
        new Map(
          [
            ...pausedRuns.slice(0, 5),
            ...runs.slice(0, 10), // listRuns returns newest first
          ].map((run) => [readString(run.id), run]),
        ).values(),
      ).filter((run) => readString(run.id))
    : []
  const nodeRunsLists = await Promise.all(
    runsForNodes.map((run) =>
      safeJson<NodeRunsPayload>(
        fetcher,
        `/api/plugins/workflow-engine/runs/${encodeURIComponent(readString(run.id))}/nodes`,
      ),
    ),
  )
  const nodesByRun = new Map<string, Array<Record<string, unknown>>>()
  let nodeFetchFailures = 0
  nodeRunsLists.forEach((list, idx) => {
    const runId = readString(runsForNodes[idx].id)
    if (list === null) {
      nodeFetchFailures += 1
      nodesByRun.set(runId, [])
      return
    }
    nodesByRun.set(runId, Array.isArray(list.nodeRuns) ? list.nodeRuns : [])
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

  // Runs finished: all-time run_count from the definitions (#5 — XP's
  // runs term must not go down as runs age out of the 200-run window).
  // Fleet-wide by construction (definitions carry no profile).
  // workflow engine has no per-profile data; profile view excludes it
  const runsFinished = runsInScope
    ? definitions.reduce((sum, def) => sum + readNumber(def.run_count), 0)
    : 0

  // "Releases" proxy: finished runs of release-flavoured workflows. No
  // release-tag endpoint exists behind the fetcher, so Shipper counts
  // completed runs whose workflow id/name matches release/deploy/ship.
  const releaseRunDatesMs = runs
    .filter((run) => {
      const status = readString(run.status).toLowerCase()
      const target =
        `${readString(run.workflow_id)} ${workflowLabel(run)}`.toLowerCase()
      return status === 'completed' && /\b(release|deploy|ship)\b/.test(target)
    })
    .map((run) => toEpochMs(run.completed_at) ?? toEpochMs(run.started_at))
    .filter((ms): ms is number => ms !== null)
  // workflow engine has no per-profile data; profile view excludes it
  const releases = runsInScope ? releaseRunDatesMs.length : 0

  // ── Kanban (shared workspace board; per-agent via assignee) ───────────
  // The board has no profile param — the assignee is the per-profile
  // key, so a set profile sees only its own tasks.
  const tasks: Array<Record<string, unknown>> = []
  const tasksByStatus = new Map<string, Array<Record<string, unknown>>>()
  if (Array.isArray(boardRaw?.board?.columns)) {
    for (const column of boardRaw.board.columns) {
      const name = readString(column.name).toLowerCase() || 'unknown'
      const rows = (Array.isArray(column.tasks) ? column.tasks : []).filter(
        (task) => profile === null || readString(task.assignee) === profile,
      )
      tasksByStatus.set(name, [...(tasksByStatus.get(name) ?? []), ...rows])
      tasks.push(...rows)
    }
  }
  const doneTasks = tasksByStatus.get('done') ?? []
  const reviewTasks = tasksByStatus.get('review') ?? []
  const tasksDone = doneTasks.length

  // ── Self-improve (verified experiment = a win; per-profile fan-out) ───
  const selfImproveWins = experiments.filter(
    (exp) => readString(exp.state).toLowerCase() === 'verified',
  ).length

  // ── Achievements plugin (badge-unlock recents; global) ────────────────
  const unlocks = Array.isArray(unlocksRaw?.unlocks) ? unlocksRaw.unlocks : []

  // ── Agents roster rows ─────────────────────────────────────────────────
  const agents: Array<DashboardAgent> = []
  for (const id of rosterList) {
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
      // Per-profile totals from the scoped sessions response only — a
      // profile absent from profile_totals is 0, never the global total.
      sessions: readNumber(profileTotals[id], 0),
      tokensWeek,
      tasksWeek,
      // Workflow runs carry no profile field (interface.ts WorkflowRun),
      // so per-agent run counts have no source; 0 rather than invented.
      runsWeek: 0,
      working,
      // No per-profile tool-name source exists behind the fetcher; the
      // column stays honest and empty rather than invented.
      topTools: [],
    })
  }

  // ── Active days / streaks (sessions + shared workflow runs) ───────────
  // Sessions come from the scoped rows (cross-profile rows when
  // profile=null); analytics daily is an active-profile view and is
  // therefore only unioned in for profile=null, where its days are a
  // subset of the true all-profile days.
  const activeDaySet = new Set<string>(runDayKeys)
  for (const row of sessionRows) {
    const at = toEpochMs(row.started_at)
    if (at !== null) activeDaySet.add(dayKeyFromMs(at))
  }
  if (profile === null && Array.isArray(analyticsRaw?.daily)) {
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

  // ── Night sessions / weekly token peak ────────────────────────────────
  // Night owl is bounded by the 100 fetched session rows.
  const nightSessions = sessionRows.filter((row) => {
    const at = toEpochMs(row.started_at)
    if (at === null) return false
    const hour = new Date(at).getHours()
    return hour >= 0 && hour < 5
  }).length
  // Token whale uses the MAXIMUM rolling 7-day window, not the current
  // week, so it cannot un-earn as weeks rotate (#9). profile=null: the
  // 30-day analytics daily rollup (active-profile view — disclosed);
  // profile set: the scoped session rows (bounded by the 100-row page).
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
  const maxWeekTokens =
    profile === null
      ? Math.max(
          maxWeekTokensFromDaily(
            Array.isArray(analyticsRaw?.daily) ? analyticsRaw.daily : [],
          ),
          weekTokens,
        )
      : weekTokens

  // ── XP / level / badges (C2 maths) ────────────────────────────────────
  const xp = computeXp({
    chatSessions: sessionsTotal,
    approvals,
    tasksDone,
    runsFinished,
  })
  const { level, levelStartXp: startXp, nextLevelXp } = levelFor(xp)

  // Earliest day any evidence covers — the fallback upper bound for
  // earned badges whose crossing the windowed history cannot show.
  const evidenceDates: Array<number> = [
    ...sessionRows.map((row) => toEpochMs(row.started_at)),
    ...runs.map((run) => toEpochMs(run.started_at)),
    ...approvalDatesMs,
    ...unlocks.map((unlock) => toEpochMs(unlock.unlocked_at)),
  ].filter((ms): ms is number => ms !== null)
  const earliestKnown =
    evidenceDates.length > 0 ? dayKeyFromMs(Math.min(...evidenceDates)) : null

  const firstEarnedDay: Record<string, string> = {}
  const sessionStartDates = sessionRows
    .map((row) => toEpochMs(row.started_at))
    .filter((ms): ms is number => ms !== null)
  const setFirstEarned = (id: string, day: string | null): void => {
    if (day) firstEarnedDay[id] = day
  }
  setFirstEarned('first-chat', firstDayCountReached(sessionStartDates, 1))
  setFirstEarned('streak-7', firstDayStreakReached(activeDays, 7))
  setFirstEarned('streak-30', firstDayStreakReached(activeDays, 30))
  // conductor/maestro cross on all-time run_count; the 200-run window
  // only proves the crossing when it falls inside it.
  setFirstEarned(
    'conductor',
    firstDayCountReached(
      runs
        .filter((run) => readString(run.status).toLowerCase() === 'completed')
        .map((run) => toEpochMs(run.completed_at) ?? toEpochMs(run.started_at))
        .filter((ms): ms is number => ms !== null),
      50,
    ),
  )
  setFirstEarned(
    'maestro',
    firstDayCountReached(
      runs
        .filter((run) => readString(run.status).toLowerCase() === 'completed')
        .map((run) => toEpochMs(run.completed_at) ?? toEpochMs(run.started_at))
        .filter((ms): ms is number => ms !== null),
      200,
    ),
  )
  setFirstEarned('gatekeeper', firstDayCountReached(approvalDatesMs, 10))
  const badges = badgeProgress({
    chatSessions: sessionsTotal,
    approvals,
    runsFinished,
    memoryFacts,
    profileCount: rosterList.length,
    releases,
    selfImproveWins,
    nightSessions,
    maxWeekTokens,
    streakDays,
    bestStreak,
    firstEarnedDay,
    earliestKnown,
    today: todayKey,
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

  // XP is only honest when every source feeding it answered (#8):
  // sessions (chats) and kanban (tasks done) always; runs+nodes
  // (approvals) and definitions (run_count) only when profile is null —
  // they feed no XP term in the profile view.
  const xpSourcesOk =
    sessionsRaw !== null &&
    boardRaw !== null &&
    (!runsInScope ||
      (runsRaw !== null &&
        definitionsRaw !== null &&
        !(
          runsForNodes.length > 0 && nodeFetchFailures === runsForNodes.length
        )))

  const operator = xpSourcesOk
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

  // workflow engine has no per-profile data; profile view excludes it
  if (runsRaw !== null && runsInScope) {
    for (const run of pausedRuns.slice(0, 5)) {
      const runId = readString(run.id)
      const nodes = nodesByRun.get(runId) ?? []
      const pausedNode = nodes.find(
        (node) => readString(node.status).toLowerCase() === 'paused',
      )
      if (!pausedNode) continue
      const nodeRunId = readString(pausedNode.id)
      // #11: no fabricated timestamps — an approval item needs a real
      // pause time; without one it is skipped.
      const pausedMs = toEpochMs(pausedNode.started_at)
      if (pausedMs === null) continue
      const completed = nodes.filter(
        (node) => readString(node.status).toLowerCase() === 'completed',
      ).length
      needsYou.push({
        kind: 'approval',
        runId,
        nodeRunId,
        workflow: workflowLabel(run),
        version: defByName.get(readString(run.workflow_id))?.version ?? '',
        // C1: pausedAt is the paused node NAME, at is the ISO pause time.
        pausedAt: readString(pausedNode.dag_node_id),
        progress:
          nodes.length > 0 ? `${completed} of ${nodes.length} nodes done` : '',
        next: readOptionalString(pausedNode.approval_message) ?? '',
        agent: readString(pausedNode.assigned_agent) || 'workflow',
        at: new Date(pausedMs).toISOString(),
      })
    }
  }

  if (cronOk) {
    for (const job of cronJobs) {
      const lastStatus = readString(job.last_status).toLowerCase()
      const lastError = readOptionalString(job.last_error)
      if (lastStatus !== 'error' && lastStatus !== 'failed' && !lastError) {
        continue
      }
      // #11: skip the item rather than invent a run time.
      const lastRun = toEpochMs(job.last_run_at)
      if (lastRun === null) continue
      needsYou.push({
        kind: 'cron-failing',
        jobId: readString(job.id) || readString(job.name) || 'unknown',
        name: readString(job.name) || readString(job.id) || 'unnamed job',
        // The cron payload exposes no failure counter — one recorded
        // failure state is the honest minimum.
        failures: 1,
        lastError: lastError ?? `last status: ${lastStatus || 'error'}`,
        agent: 'cron',
        at: new Date(lastRun).toISOString(),
      })
    }
  }

  if (boardRaw !== null) {
    for (const task of reviewTasks.slice(0, 5)) {
      // #11: skip the item rather than invent a move time.
      const at = toEpochMs(task.updated_at) ?? toEpochMs(task.started_at)
      if (at === null) continue
      needsYou.push({
        kind: 'task-review',
        taskId: readString(task.id),
        title: readString(task.title) || 'untitled task',
        board: readString(task.tenant) || 'default',
        agent: readString(task.assignee) || 'unassigned',
        at: new Date(at).toISOString(),
      })
    }
  }

  // ── Recent activity (newest 5 across sources; no invented times) ──────
  const recentCandidates: Array<RecentItem> = []
  // QA follow-up #2: a cron run and the chat session that run created
  // are ONE row. Anchors are (job name, last_run_at) pairs; a chat row
  // whose title contains the job name and whose time (last_active ??
  // started_at) sits within ±5 min of the run is dropped in favour of
  // the cron row — before the newest-5 cut, never after.
  const cronAnchors: Array<{ name: string; at: number }> = []

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
  // workflow engine has no per-profile data; profile view excludes it
  // (QA follow-up #3 — same rule as XP and counts.workflows)
  if (runsRaw !== null && runsInScope) {
    for (const run of runs.slice(0, 10)) {
      const at = toEpochMs(run.started_at)
      if (at === null) continue
      const status = readString(run.status)
      recentCandidates.push({
        at: new Date(at).toISOString(),
        kind: 'workflow',
        title: `${workflowLabel(run)} ${status}`,
        sub: status === 'completed' ? 'run finished' : `run ${status}`,
        who: 'workflow',
        href: '/workflows',
      })
    }
  }
  if (cronOk) {
    for (const job of cronJobs) {
      const at = toEpochMs(job.last_run_at)
      if (at === null) continue
      const name = readString(job.name)
      if (name) cronAnchors.push({ name, at })
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
  if (boardRaw !== null) {
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
  if (memoryOk) {
    // Day-granular source: the day boundary itself is the timestamp.
    for (const day of [...memoryDays].reverse()) {
      if (readNumber(day.count) <= 0) continue
      recentCandidates.push({
        at: `${day.date}T00:00:00.000Z`,
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
  const isCronSessionDuplicate = (item: RecentItem): boolean => {
    if (item.kind !== 'chat') return false
    const at = Date.parse(item.at)
    const title = item.title.toLowerCase()
    return cronAnchors.some(
      (anchor) =>
        title.includes(anchor.name.toLowerCase()) &&
        Math.abs(at - anchor.at) <= 5 * 60_000,
    )
  }
  const recent = recentCandidates
    .filter((item) => !isCronSessionDuplicate(item))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 5)

  // ── Counts (null only when every contributing source failed) ─────────
  const gatewayOk =
    healthRaw !== null &&
    (readString(healthRaw.gateway_state).toLowerCase() === 'running' ||
      readString(healthRaw.status).toLowerCase() === 'ok' ||
      readNumber(healthRaw.active_agents) > 0)
  // QA follow-up #5: `counts.workflows` is the known-workflows count
  // (the plan's "active/known workflows" ring) sourced from the
  // definitions list length. The old source (runsFinished, the sum of
  // definitions run_count) read 0 live because run_count is optional
  // ("absent on legacy rows", WorkflowDefinitionRow) and the live rows
  // do not carry it; the definitions list itself is non-empty and real.
  // workflow engine has no per-profile data; profile view excludes it
  // (0 for a set profile).
  const workflowsKnown = runsInScope ? definitions.length : 0
  const sourcesOk = [
    sessionsRaw !== null,
    cronOk,
    experimentsOk,
    memoryOk,
    boardRaw !== null,
    // workflow engine has no per-profile data; profile view excludes
    // it — its sources must not keep `counts` alive for a set profile
    ...(runsInScope ? [runsRaw !== null, definitionsRaw !== null] : []),
  ].filter(Boolean).length
  const counts =
    sourcesOk > 0
      ? {
          chats: sessionsTotal,
          needsYou: needsYou.length,
          workflows: workflowsKnown,
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
    agents: rosterList.length > 0 || sessionsRaw !== null ? agents : null,
    hotTopics: sessionsRaw !== null ? computeHotTopics(sessionRows, now) : null,
    counts,
    needsYou: runsRaw !== null || cronOk || boardRaw !== null ? needsYou : null,
    recent,
    badges,
  }
}
