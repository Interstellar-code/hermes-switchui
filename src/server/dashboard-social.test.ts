import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  badgeProgress,
  bestStreakFrom,
  buildDashboardSocial,
  computeXp,
  levelFor,
  streakFrom,
} from './dashboard-social'
import type { DashboardFetcher } from './dashboard-aggregator'

// ── Test clock: fixed "now" so streaks/weeks are deterministic. ─────────────
const NOW = new Date(2026, 9, 9, 12, 0, 0) // Oct 9 2026, local noon
const DAY_MS = 86_400_000

function dayKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
function isoDay(day: string): string {
  return `${day}T00:00:00.000Z`
}
const TODAY = dayKey(NOW)
const YESTERDAY = dayKey(new Date(NOW.getTime() - DAY_MS))
const TWO_DAYS_AGO = dayKey(new Date(NOW.getTime() - 2 * DAY_MS))
const THREE_DAYS_AGO = dayKey(new Date(NOW.getTime() - 3 * DAY_MS))
const EIGHT_DAYS_AGO = dayKey(new Date(NOW.getTime() - 8 * DAY_MS))
const SEC = (d: Date) => Math.floor(d.getTime() / 1000)
const ISO = (d: Date) => d.toISOString()

// ── Fixtures shaped like the real upstream payloads ─────────────────────────

/** Started/last-active for session row i (deterministic recency ladder). */
function rowDate(i: number): Date {
  if (i === 0) return new Date(NOW.getTime() - 30 * 60_000) // 30 min ago
  if (i === 1) return new Date(NOW.getTime() - 26 * 3_600_000) // 26 h ago
  if (i === 2) return new Date(NOW.getTime() - 30 * 3_600_000) // 30 h ago
  if (i === 3) return new Date(NOW.getTime() - 8 * DAY_MS) // outside 7-day window
  return new Date(NOW.getTime() - 6 * DAY_MS) // inside window, quiet
}

const sessionsFixture = {
  // 100 rows on the wire, but total says 150 — counts must use `total`.
  sessions: Array.from({ length: 100 }, (_, i) => ({
    id: `s_${i}`,
    profile: i < 60 ? 'hermes-switch' : 'neo',
    title:
      i === 0
        ? 'Plan the dashboard revamp session'
        : i === 1
          ? 'dashboard revamp'
          : i === 2
            ? 'gateway timeouts investigation'
            : i === 3
              ? 'Old session title'
              : `chat ${i}`,
    started_at: SEC(rowDate(i)),
    last_active: SEC(rowDate(i)),
    // Row 5 is the live heartbeat: an in-flight session for
    // hermes-switch (timestamps stay old so `recent` is unaffected).
    ...(i === 5 ? { is_active: true } : {}),
    message_count: 3 + i,
    input_tokens: 1000 * ((i % 5) + 1),
    output_tokens: 500 * ((i % 3) + 1),
  })),
  total: 150,
  profile_totals: { 'hermes-switch': 90, neo: 60 },
}

const analyticsFixture = {
  totals: { total_sessions: 150, total_input: 900_000, total_output: 400_000 },
  daily: [
    {
      day: THREE_DAYS_AGO,
      sessions: 2,
      input_tokens: 60_000,
      output_tokens: 40_000,
    },
    {
      day: TWO_DAYS_AGO,
      sessions: 2,
      input_tokens: 120_000,
      output_tokens: 80_000,
    },
    {
      day: YESTERDAY,
      sessions: 2,
      input_tokens: 30_000,
      output_tokens: 20_000,
    },
    { day: TODAY, sessions: 2, input_tokens: 90_000, output_tokens: 60_000 },
  ],
}

// Cron jobs are per-profile (the API takes ?profile=): disjoint lists.
const cronJobsByProfile: Record<string, Array<Record<string, unknown>>> = {
  'hermes-switch': [
    {
      id: 'cron_31',
      name: 'nightly-digest',
      last_status: 'error',
      last_error: 'gateway timeout after 30s',
      last_run_at: ISO(new Date(NOW.getTime() - 3 * 3_600_000)),
    },
    {
      id: 'cron_32',
      name: 'hourly-heartbeat',
      last_status: 'ok',
      last_run_at: ISO(new Date(NOW.getTime() - 8 * DAY_MS)),
    },
    {
      // Failing but timestamp-less: must be skipped, never back-dated.
      id: 'cron_34',
      name: 'silent-job',
      last_status: 'error',
      last_error: 'exploded',
    },
  ],
  neo: [
    {
      id: 'cron_33',
      name: 'neo-weekly',
      last_status: 'ok',
      last_run_at: ISO(new Date(NOW.getTime() - 2 * DAY_MS)),
    },
  ],
}

// Only real WorkflowRun fields — no invented metadata keys.
const runsFixture = {
  runs: [
    {
      id: 'run_1',
      workflow_id: 'release-train',
      status: 'completed',
      started_at: ISO(new Date(NOW.getTime() - 3 * DAY_MS)),
      completed_at: ISO(new Date(NOW.getTime() - 3 * DAY_MS + 600_000)),
    },
    {
      id: 'run_2',
      workflow_id: 'release-train',
      status: 'completed',
      started_at: ISO(new Date(NOW.getTime() - 2 * DAY_MS)),
      completed_at: ISO(new Date(NOW.getTime() - 2 * DAY_MS + 600_000)),
    },
    {
      id: 'run_3',
      workflow_id: 'data-pipeline',
      status: 'completed',
      started_at: ISO(new Date(NOW.getTime() - DAY_MS)),
      completed_at: ISO(new Date(NOW.getTime() - DAY_MS + 600_000)),
    },
    {
      id: 'run_4',
      workflow_id: 'release-train',
      status: 'paused',
      started_at: ISO(new Date(NOW.getTime() - 2 * 3_600_000)),
    },
  ],
}

const nodeRunsFixture: Record<string, unknown> = {
  run_1: {
    nodeRuns: [
      {
        id: 'node_1_1',
        dag_node_id: 'build',
        status: 'completed',
        approval_response: 'ship it',
        completed_at: ISO(new Date(NOW.getTime() - 3 * DAY_MS)),
      },
      { id: 'node_1_2', dag_node_id: 'test', status: 'completed' },
    ],
  },
  run_2: {
    nodeRuns: [
      {
        id: 'node_2_1',
        dag_node_id: 'approve',
        status: 'completed',
        approval_response: 'ok',
        completed_at: ISO(new Date(NOW.getTime() - 2 * DAY_MS)),
      },
    ],
  },
  // run_3 has no entry: a failed node-runs fetch must degrade, not crash.
  run_4: {
    nodeRuns: [
      { id: 'node_4_1', dag_node_id: 'publish', status: 'completed' },
      {
        id: 'node_4_2',
        dag_node_id: 'gate',
        status: 'paused',
        started_at: ISO(new Date(NOW.getTime() - 2 * 3_600_000)),
        approval_message: 'Publish GitHub release',
        assigned_agent: 'hermes-switch',
      },
    ],
  },
}

// Workflow names/versions come from the definitions, not run metadata.
const definitionsFixture = {
  definitions: [
    {
      id: 'release-train',
      name: 'release-train',
      version: 'v3',
      run_count: 106,
    },
    { id: 'data-pipeline', name: 'data-pipeline', version: null, run_count: 0 },
  ],
}

const experimentsByProfile: Record<string, Array<Record<string, unknown>>> = {
  'hermes-switch': [
    { id: 1, state: 'verified' },
    { id: 2, state: 'live' },
  ],
  neo: [
    { id: 3, state: 'verified' },
    { id: 4, state: 'reverted' },
  ],
}

const achievementsFixture = {
  achievements: [{ id: 'a1', name: 'First steps', state: 'unlocked' }],
}

const unlocksFixture = {
  unlocks: [
    {
      id: 'a1',
      name: 'First steps',
      description: 'first verified win',
      unlocked_at: SEC(new Date(NOW.getTime() - 20 * 3_600_000)),
    },
  ],
}

// Memory banks are per-profile: facts split across the two banks (131).
const memoryByProfile: Record<string, unknown> = {
  'hermes-switch': {
    days: [
      { date: TWO_DAYS_AGO, count: 0 },
      { date: YESTERDAY, count: 2 },
      { date: TODAY, count: 0 },
    ],
    totals: { fact: 100, gist: 4, episodic: 10, working: 6, entity: 2 },
  },
  neo: {
    days: [{ date: YESTERDAY, count: 1 }],
    totals: { fact: 31, gist: 0, episodic: 0, working: 0, entity: 0 },
  },
}

const statusFixture = {
  // ghost exists as a profile but has no sessions and no per-profile
  // data: it must read as 0 everywhere, never the global totals (#4).
  profiles: ['hermes-switch', 'neo', 'ghost'],
  hermes_home: '/home/u/.hermes/profiles/hermes-switch',
  gateways: [{ profile: 'hermes-switch' }],
}

const boardFixture = {
  board: {
    columns: [
      {
        name: 'backlog',
        tasks: [
          {
            id: 'k_1',
            title: 'backlog item',
            created_at: SEC(new Date(NOW.getTime() - 9 * DAY_MS)),
          },
        ],
      },
      {
        name: 'done',
        tasks: [
          {
            id: 'k_2',
            title: 'Agents tab merged',
            assignee: 'neo',
            status: 'done',
            completed_at: SEC(new Date(NOW.getTime() - 5 * 3_600_000)),
          },
          {
            id: 'k_3',
            title: 'Old done task',
            assignee: 'neo',
            status: 'done',
            completed_at: SEC(new Date(NOW.getTime() - 9 * DAY_MS)),
          },
        ],
      },
      {
        name: 'review',
        tasks: [
          {
            id: 'k_4',
            title: 'Review agents tab sidebar list',
            assignee: 'neo',
            status: 'review',
            started_at: SEC(new Date(NOW.getTime() - 30 * 3_600_000)),
          },
        ],
      },
    ],
    tenants: ['switchui'],
  },
}

const healthFixture = { gateway_state: 'running', active_agents: 2 }

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Upstreams proven to honour ?profile= (review #3). */
const PROFILE_SCOPED_BARES = new Set([
  '/api/profiles/sessions',
  '/api/cron/jobs',
  '/api/plugins/karpathy-self-improve/experiments',
  '/api/memory/activity',
])

type FailMode = 'throw' | '500' | 'hang'

/** Fake `(path) => Response` fetcher: the ONLY thing stubbed here. */
function makeFetcher(
  opts: {
    fail?: Record<string, FailMode | undefined>
  } = {},
) {
  const requestedPaths: Array<string> = []
  const fail = opts.fail ?? {}
  const fetcher: DashboardFetcher = (path) => {
    requestedPaths.push(path)
    const url = new URL(path, 'http://upstream.local')
    const bare = url.pathname
    const profileParam = url.searchParams.get('profile')
    const mode: FailMode | undefined = fail[bare] ?? fail[path]
    const answer = (): Response | Promise<Response> => {
      if (mode === 'throw') return Promise.reject(new Error(`boom: ${path}`))
      if (mode === '500')
        return Promise.resolve(jsonResponse({ error: 'upstream down' }, 500))
      if (mode === 'hang') return new Promise<Response>(() => {})
      if (bare === '/api/profiles/sessions') {
        // The real scoped endpoint returns only that profile's rows.
        const rows = profileParam
          ? sessionsFixture.sessions.filter(
              (row) => row.profile === profileParam,
            )
          : sessionsFixture.sessions
        return jsonResponse({ ...sessionsFixture, sessions: rows })
      }
      if (bare === '/api/analytics/usage') return jsonResponse(analyticsFixture)
      if (bare === '/api/cron/jobs') {
        const jobs = profileParam
          ? (cronJobsByProfile[profileParam] ?? [])
          : cronJobsByProfile['hermes-switch']
        return jsonResponse({ jobs })
      }
      if (bare === '/api/plugins/workflow-engine/runs')
        return jsonResponse(runsFixture)
      const nodeMatch =
        /^\/api\/plugins\/workflow-engine\/runs\/([^/]+)\/nodes$/.exec(bare)
      if (nodeMatch) {
        const fixture = nodeRunsFixture[nodeMatch[1]]
        // Unknown run id → 500 (the safeJson helper must swallow it).
        return fixture
          ? jsonResponse(fixture)
          : jsonResponse({ error: 'no such run' }, 500)
      }
      if (bare === '/api/plugins/workflow-engine/definitions')
        return jsonResponse(definitionsFixture)
      if (bare === '/api/plugins/karpathy-self-improve/experiments') {
        const experiments = profileParam
          ? (experimentsByProfile[profileParam] ?? [])
          : experimentsByProfile['hermes-switch']
        return jsonResponse({ experiments })
      }
      if (bare === '/api/plugins/hermes-achievements/achievements')
        return jsonResponse(achievementsFixture)
      if (bare === '/api/plugins/hermes-achievements/recent-unlocks')
        return jsonResponse(unlocksFixture)
      if (bare === '/api/memory/activity') {
        const activity = profileParam
          ? (memoryByProfile[profileParam] ?? {
              days: [],
              totals: { fact: 0 },
            })
          : memoryByProfile['hermes-switch']
        return jsonResponse(activity)
      }
      if (bare === '/api/plugins/kanban/board')
        return jsonResponse(boardFixture)
      if (bare === '/api/status') return jsonResponse(statusFixture)
      return Promise.reject(new Error(`unexpected path: ${path}`))
    }
    return Promise.resolve().then(answer)
  }
  const gatewayFetcher: DashboardFetcher = (path) => {
    requestedPaths.push(path)
    if (path.startsWith('/health/detailed'))
      return Promise.resolve(jsonResponse(healthFixture))
    return Promise.reject(new Error(`unexpected gateway path: ${path}`))
  }
  return { fetcher, gatewayFetcher, requestedPaths }
}

// ── C2 pure functions ───────────────────────────────────────────────────────

describe('computeXp', () => {
  it('sums the C2 weights: 10·chats + 25·approvals + 40·tasks + 5·runs', () => {
    expect(
      computeXp({
        chatSessions: 3,
        approvals: 2,
        tasksDone: 1,
        runsFinished: 4,
      }),
    ).toBe(3 * 10 + 2 * 25 + 1 * 40 + 4 * 5)
  })
})

describe('levelFor', () => {
  it('maps the C2 bounds: 0→L1, 999→L1, 1000→L2, 3000→L3', () => {
    expect(levelFor(0).level).toBe(1)
    expect(levelFor(999).level).toBe(1)
    expect(levelFor(1000).level).toBe(2)
    expect(levelFor(3000).level).toBe(3)
  })

  it('reports the level bounds: level n starts at 500·n·(n-1)', () => {
    expect(levelFor(0)).toEqual({
      level: 1,
      levelStartXp: 0,
      nextLevelXp: 1000,
    })
    expect(levelFor(999)).toEqual({
      level: 1,
      levelStartXp: 0,
      nextLevelXp: 1000,
    })
    expect(levelFor(1000)).toEqual({
      level: 2,
      levelStartXp: 1000,
      nextLevelXp: 3000,
    })
    expect(levelFor(3000)).toEqual({
      level: 3,
      levelStartXp: 3000,
      nextLevelXp: 6000,
    })
  })
})

describe('streakFrom', () => {
  it('counts consecutive days ending today', () => {
    expect(streakFrom([TODAY, YESTERDAY, TWO_DAYS_AGO], TODAY)).toBe(3)
  })

  it('breaks across a gap', () => {
    // Active today, gap yesterday, run of two before the gap.
    expect(streakFrom([TODAY, TWO_DAYS_AGO, THREE_DAYS_AGO], TODAY)).toBe(1)
  })

  it('ends on yesterday when today has no activity yet', () => {
    expect(streakFrom([YESTERDAY, TWO_DAYS_AGO, THREE_DAYS_AGO], TODAY)).toBe(3)
  })

  it('is 0 with no activity at all', () => {
    expect(streakFrom([], TODAY)).toBe(0)
  })
})

describe('bestStreakFrom', () => {
  it('finds the longest run even when the current streak is shorter', () => {
    // Active today, gap yesterday, run of two before the gap: current
    // streak is 1, best is 2.
    expect(bestStreakFrom([TODAY, TWO_DAYS_AGO, THREE_DAYS_AGO])).toBe(2)
  })

  it('handles unordered input and duplicates', () => {
    expect(bestStreakFrom([YESTERDAY, TODAY, TODAY, YESTERDAY])).toBe(2)
  })
})

describe('badgeProgress', () => {
  const base = {
    chatSessions: 150,
    approvals: 2,
    runsFinished: 106,
    memoryFacts: 131,
    profileCount: 2,
    releases: 0,
    selfImproveWins: 2,
    nightSessions: 7,
    maxWeekTokens: 4_200_000,
    streakDays: 3,
    bestStreak: 3,
  }

  it('earns a badge iff have >= need', () => {
    const badges = badgeProgress({ ...base, today: TODAY })
    const byId = new Map(badges.map((b) => [b.id, b]))
    // No history given: earned badges fall back to the measurement day
    // (C1 types null as unearned), unearned ones stay null.
    expect(byId.get('first-chat')?.earnedAt).toBe(isoDay(TODAY))
    expect(byId.get('conductor')?.earnedAt).toBe(isoDay(TODAY)) // 106 >= 50
    expect(byId.get('night-owl')?.earnedAt).toBeNull() // 7 < 10
    expect(byId.get('token-whale')?.earnedAt).toBeNull() // 4.2M < 5M
    expect(byId.get('maestro')?.earnedAt).toBeNull() // 106 < 200
    for (const badge of badges) {
      expect(badge.earnedAt !== null).toBe(badge.have >= badge.need)
    }
  })

  it('uses the computed first day (full ISO) when history can tell', () => {
    const badges = badgeProgress({
      ...base,
      today: TODAY,
      firstEarnedDay: { 'memory-keeper': '2026-09-05' },
    })
    expect(badges.find((b) => b.id === 'memory-keeper')?.earnedAt).toBe(
      '2026-09-05T00:00:00.000Z',
    )
  })

  it('falls back to the earliest provable day for earned-but-unknown', () => {
    const badges = badgeProgress({
      ...base,
      today: TODAY,
      earliestKnown: '2026-01-01',
    })
    expect(badges.find((b) => b.id === 'conductor')?.earnedAt).toBe(
      '2026-01-01T00:00:00.000Z',
    )
    // Unearned badges stay null regardless of the fallback.
    expect(badges.find((b) => b.id === 'maestro')?.earnedAt).toBeNull()
  })

  it('covers exactly the 12 mock badges with have/need numbers', () => {
    const badges = badgeProgress({ ...base, today: TODAY })
    expect(badges.map((b) => b.id)).toEqual([
      'first-chat',
      'streak-7',
      'conductor',
      'gatekeeper',
      'memory-keeper',
      'fleet',
      'shipper',
      'self-made',
      'night-owl',
      'token-whale',
      'maestro',
      'streak-30',
    ])
    const gatekeeper = badges.find((b) => b.id === 'gatekeeper')
    expect(gatekeeper?.have).toBe(2)
    expect(gatekeeper?.need).toBe(10)
  })
})

// ── Builder ─────────────────────────────────────────────────────────────────

describe('buildDashboardSocial', () => {
  it('returns the full C1 object when every source is ok', async () => {
    const { fetcher, gatewayFetcher } = makeFetcher()
    const data = await buildDashboardSocial({
      fetcher,
      gatewayFetcher,
      profile: null,
      now: NOW,
    })

    expect(data.profile).toBeNull()
    expect(data.generatedAt).toBe(NOW.toISOString())

    // XP = 10·150 chats + 25·2 approvals + 40·2 done tasks + 5·106
    // all-time runs (definitions run_count) = 1500+50+80+530 = 2160
    // → level 2 (1000..2999).
    expect(data.operator).toMatchObject({
      xp: 2160,
      level: 2,
      levelStartXp: 1000,
      nextLevelXp: 3000,
      // Active days: Oct 6..9 all have sessions/runs; Oct 3 rows are
      // isolated by the Oct 4-5 gap → current and best streak are 4.
      streakDays: 4,
      bestStreak: 4,
    })
    expect(data.operator?.activeDays).toHaveLength(7)
    const todayIndex = (NOW.getDay() + 6) % 7
    expect(data.operator?.activeDays[todayIndex]).toBe(true)

    // Agents from the roster with per-profile totals, not row counts.
    expect(data.agents).not.toBeNull()
    const hs = data.agents?.find((a) => a.id === 'hermes-switch')
    const neo = data.agents?.find((a) => a.id === 'neo')
    expect(hs?.sessions).toBe(90)
    expect(neo?.sessions).toBe(60)
    expect(neo?.tasksWeek).toBe(1) // one done task this week, one 9 days old
    // Workflow runs carry no profile field: runsWeek is 0, not invented.
    expect(hs?.runsWeek).toBe(0)
    expect(hs?.working).toBe(true) // row 5: in-flight session (is_active)
    expect(neo?.working).toBe(false) // all neo rows are 6 days quiet

    // Hot topics: top words from this week's session titles, stop-worded.
    expect(data.hotTopics).toEqual([
      { label: 'dashboard', href: '/chat' },
      { label: 'revamp', href: '/chat' },
      { label: 'gateway', href: '/chat' },
      { label: 'investigation', href: '/chat' },
      { label: 'plan', href: '/chat' },
    ])

    expect(data.counts).toMatchObject({
      chats: 150,
      workflows: 2, // definitions count (known workflows), QA follow-up #5
      cron: 4, // 3 (hermes-switch, incl. the timestamp-less job) + 1 (neo)
      tasks: 4,
      memory: 131, // 100 + 31 across the two profile banks
      selfImprove: 2, // 1 verified per profile
      gatewayOk: true,
    })
    expect(data.counts?.needsYou).toBe(data.needsYou?.length)

    // Needs You approval item: C1 semantics (#1) — pausedAt is the node
    // NAME, progress counts nodes, at is the ISO pause time, and the
    // workflow/version come from the definition, not run metadata (#2).
    const approval = data.needsYou?.find((n) => n.kind === 'approval')
    expect(approval).toEqual({
      kind: 'approval',
      runId: 'run_4',
      nodeRunId: 'node_4_2',
      workflow: 'release-train',
      version: 'v3',
      pausedAt: 'gate',
      progress: '1 of 2 nodes done',
      next: 'Publish GitHub release',
      agent: 'hermes-switch',
      at: ISO(new Date(NOW.getTime() - 2 * 3_600_000)),
    })
    const cronFail = data.needsYou?.find((n) => n.kind === 'cron-failing')
    expect(cronFail).toMatchObject({
      jobId: 'cron_31',
      name: 'nightly-digest',
      lastError: 'gateway timeout after 30s',
    })
    // cron_34 fails but has no last_run_at: skipped, never back-dated (#11).
    expect(
      data.needsYou?.some(
        (n) => n.kind === 'cron-failing' && n.jobId === 'cron_34',
      ),
    ).toBe(false)
    expect(data.needsYou?.find((n) => n.kind === 'task-review')).toMatchObject({
      taskId: 'k_4',
      title: 'Review agents tab sidebar list',
    })

    // Recent: newest 10 (the UI shows as many as fit), descending, real page hrefs only.
    expect(data.recent).toHaveLength(10)
    const times = data.recent?.map((r) => Date.parse(r.at)) ?? []
    expect([...times].sort((a, b) => b - a)).toEqual(times)
    expect(
      new Set(data.recent?.map((r) => r.kind)).size,
    ).toBeGreaterThanOrEqual(3)
    for (const item of data.recent ?? []) {
      expect(item.href).toMatch(
        /^\/(chat|workflows|jobs|tasks|memory|dashboard)$/,
      )
    }

    // Badges: earnedAt is full ISO (#10); first-chat's crossing is the
    // earliest session row; conductor falls back to the earliest
    // evidence day because the 200-run window cannot show 50 crossings.
    expect(data.badges).toHaveLength(12)
    const byId = new Map((data.badges ?? []).map((b) => [b.id, b]))
    expect(byId.get('first-chat')?.earnedAt).toBe(isoDay(EIGHT_DAYS_AGO))
    expect(byId.get('conductor')?.earnedAt).toBe(isoDay(EIGHT_DAYS_AGO))
    expect(byId.get('token-whale')?.have).toBe(500_000) // max rolling week
    expect(byId.get('token-whale')?.earnedAt).toBeNull()
  })

  it('nulls only the failing slice when one upstream throws', async () => {
    const { fetcher } = makeFetcher({ fail: { '/api/cron/jobs': 'throw' } })
    const data = await buildDashboardSocial({
      fetcher,
      profile: null,
      now: NOW,
    })
    // Cron does not feed XP: the operator card stays.
    expect(data.operator).not.toBeNull()
    expect(data.badges).toHaveLength(12)
    expect(data.needsYou?.some((n) => n.kind === 'cron-failing')).toBe(false)
    expect(data.counts?.cron).toBe(0) // degraded counter, slice still alive
    expect(data.counts?.chats).toBe(150)
  })

  it('nulls the operator when an XP-feeding source returns 500 (#8)', async () => {
    const { fetcher } = makeFetcher({
      fail: { '/api/plugins/workflow-engine/runs': '500' },
    })
    const data = await buildDashboardSocial({
      fetcher,
      profile: null,
      now: NOW,
    })
    // Approvals are unreadable → XP would be invented, so the operator
    // slice nulls instead of showing a lower XP as if real.
    expect(data.operator).toBeNull()
    expect(data.needsYou?.some((n) => n.kind === 'approval')).toBe(false)
    expect(data.recent?.every((r) => r.kind !== 'workflow')).toBe(true)
    expect(data.counts).not.toBeNull()
  })

  it('nulls the operator when the definitions (all-time run_count) fail (#8)', async () => {
    const { fetcher } = makeFetcher({
      fail: { '/api/plugins/workflow-engine/definitions': '500' },
    })
    const data = await buildDashboardSocial({
      fetcher,
      profile: null,
      now: NOW,
    })
    expect(data.operator).toBeNull()
    expect(data.badges).toHaveLength(12) // badges degrade, not null
    expect(data.counts?.memory).toBe(131)
  })

  it('nulls the sessions slice when sessions time out (8 s deadline, fake timers)', async () => {
    vi.useFakeTimers()
    try {
      const { fetcher } = makeFetcher({
        fail: { '/api/profiles/sessions': 'hang' },
      })
      const pending = buildDashboardSocial({
        fetcher,
        profile: null,
        now: NOW,
      })
      await vi.advanceTimersByTimeAsync(8_000)
      const data = await pending
      expect(data.operator).toBeNull()
      expect(data.hotTopics).toBeNull()
      expect(data.badges).not.toBeNull() // badges survive on other counters
      expect(data.counts).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('fills the slice when an upstream answers between 4 s and 8 s (fake timers)', async () => {
    vi.useFakeTimers()
    try {
      const { fetcher } = makeFetcher()
      // The old 4 s deadline cut cold-server upstreams (5–7 s) off;
      // the QA follow-up raises the deadline to 8 s, so a 5 s answer
      // must still fill its slice.
      const slow: DashboardFetcher = (path) =>
        path.startsWith('/api/profiles/sessions')
          ? new Promise<Response>((resolve) => {
              setTimeout(() => {
                fetcher(path).then(resolve)
              }, 5_000)
            })
          : fetcher(path)
      const pending = buildDashboardSocial({
        fetcher: slow,
        profile: null,
        now: NOW,
      })
      await vi.advanceTimersByTimeAsync(5_000)
      const data = await pending
      expect(data.operator).not.toBeNull()
      expect(data.hotTopics).not.toBeNull()
      expect(data.counts?.chats).toBe(150)
    } finally {
      vi.useRealTimers()
    }
  })

  it('scopes only the proven upstreams and leaves the rest unscoped (#3)', async () => {
    const { fetcher, gatewayFetcher, requestedPaths } = makeFetcher()
    await buildDashboardSocial({
      fetcher,
      gatewayFetcher,
      profile: 'neo',
      now: NOW,
    })
    expect(requestedPaths.length).toBeGreaterThan(0)
    for (const path of requestedPaths) {
      const bare = new URL(path, 'http://x.local').pathname
      if (PROFILE_SCOPED_BARES.has(bare)) {
        expect(path).toContain('profile=neo')
      } else {
        // Unprovable upstreams are called bare — a silently ignored
        // ?profile= is exactly what the review forbids.
        expect(path).not.toContain('profile=')
      }
    }
    // The node-runs fan-out stays unscoped too — and never happens for a
    // set profile (workflow data is excluded from the profile view).
    expect(requestedPaths.some((p) => p.includes('/nodes'))).toBe(false)
  })

  it('fans the per-profile sources out over the roster when profile is null', async () => {
    const { fetcher, requestedPaths } = makeFetcher()
    const data = await buildDashboardSocial({
      fetcher,
      profile: null,
      now: NOW,
    })
    expect(requestedPaths).toContain('/api/cron/jobs?profile=hermes-switch')
    expect(requestedPaths).toContain('/api/cron/jobs?profile=neo')
    expect(requestedPaths).toContain(
      '/api/plugins/karpathy-self-improve/experiments?profile=neo',
    )
    expect(
      requestedPaths.some(
        (p) =>
          p.startsWith('/api/memory/activity') &&
          p.includes('profile=hermes-switch'),
      ),
    ).toBe(true)
    // The node-runs fan-out runs only for the fleet view (profile null).
    expect(requestedPaths).toContain(
      '/api/plugins/workflow-engine/runs/run_4/nodes',
    )
    // No unscoped per-profile call slipped through.
    expect(requestedPaths).not.toContain('/api/cron/jobs')
    expect(data.counts?.cron).toBe(4)
    expect(data.counts?.memory).toBe(131)
    expect(data.counts?.selfImprove).toBe(2)
  })

  it('uses sessions total, not the capped 100-row list length', async () => {
    const { fetcher } = makeFetcher()
    const data = await buildDashboardSocial({
      fetcher,
      profile: null,
      now: NOW,
    })
    // 150 total with 100 rows on the wire: chats and XP follow `total`.
    expect(data.counts?.chats).toBe(150)
    expect(data.operator?.xp).toBe(2160)
  })

  it('scopes per-profile session counts when a profile is set', async () => {
    const { fetcher } = makeFetcher()
    const data = await buildDashboardSocial({
      fetcher,
      profile: 'neo',
      now: NOW,
    })
    // 60 chats + 2 of neo's done tasks; no run or approval terms.
    expect(data.operator?.xp).toBe(10 * 60 + 40 * 2)
    expect(data.profile).toBe('neo')
  })

  it('profile view excludes unscoped workflow and kanban data (R3 #1)', async () => {
    const { fetcher } = makeFetcher()
    const data = await buildDashboardSocial({
      fetcher,
      profile: 'neo',
      now: NOW,
    })

    // XP has no run/approval terms: 10·60 chats + 40·2 neo tasks done.
    expect(data.operator?.xp).toBe(10 * 60 + 40 * 2)
    expect(data.operator?.streakDays).toBe(0) // sessions only: all neo
    expect(data.operator?.bestStreak).toBe(1) // rows are on Oct 3
    // Fleet runs (106) and the paused approval are not neo's numbers.
    expect(data.counts?.workflows).toBe(0)
    expect(data.needsYou?.some((n) => n.kind === 'approval')).toBe(false)
    // Kanban filtered by assignee === 'neo': k_2, k_3 (done), k_4
    // (review); k_1 (unassigned backlog) is not neo's.
    expect(data.counts?.tasks).toBe(3)
    expect(data.needsYou?.find((n) => n.kind === 'task-review')).toMatchObject({
      taskId: 'k_4',
    })
    // Run-based badges carry no fleet counts into the profile view.
    const byId = new Map((data.badges ?? []).map((b) => [b.id, b]))
    expect(byId.get('conductor')?.have).toBe(0)
    expect(byId.get('shipper')?.have).toBe(0)
  })

  it('treats a profile absent from profile_totals as 0, never the global total (#4)', async () => {
    const { fetcher } = makeFetcher()
    const data = await buildDashboardSocial({
      fetcher,
      profile: 'ghost',
      now: NOW,
    })
    expect(data.counts?.chats).toBe(0)
    // No chats, no neo-assigned tasks, no run/approval terms: XP is 0.
    expect(data.operator?.xp).toBe(0)
    expect(data.counts?.tasks).toBe(0)
    const ghost = data.agents?.find((a) => a.id === 'ghost')
    expect(ghost?.sessions).toBe(0)
  })

  it('merges a cron run and the chat session it created into one recent row (QA #2)', async () => {
    const { fetcher } = makeFetcher()
    // The cron run at NOW-32min and the session it spawned (title embeds
    // the job name, last_active 2 min later) — the exact live QA shape.
    const cronJob = {
      id: 'cron_email',
      name: 'Email Check Combined (Gmail + Interstellar)',
      last_status: 'ok',
      last_run_at: ISO(new Date(NOW.getTime() - 32 * 60_000)),
    }
    const sessionRow = {
      id: 's_cron',
      profile: 'hermes-switch',
      title: 'Email Check Combined (Gmail + Interstellar) · Oct 09 09:03',
      started_at: SEC(new Date(NOW.getTime() - 32 * 60_000)),
      last_active: SEC(new Date(NOW.getTime() - 30 * 60_000)),
      message_count: 4,
      input_tokens: 100,
      output_tokens: 50,
    }
    const wrapped: DashboardFetcher = (path) => {
      if (path.startsWith('/api/profiles/sessions')) {
        return Promise.resolve(
          jsonResponse({
            ...sessionsFixture,
            sessions: [sessionRow, ...sessionsFixture.sessions.slice(0, 9)],
          }),
        )
      }
      if (path.startsWith('/api/cron/jobs')) {
        const profileParam = new URL(path, 'http://x.local').searchParams.get(
          'profile',
        )
        // The job belongs to hermes-switch only — one row per profile.
        const jobs =
          profileParam === 'hermes-switch'
            ? [cronJob, ...cronJobsByProfile['hermes-switch']]
            : profileParam
              ? (cronJobsByProfile[profileParam] ?? [])
              : [cronJob]
        return Promise.resolve(jsonResponse({ jobs }))
      }
      return fetcher(path)
    }
    const data = await buildDashboardSocial({
      fetcher: wrapped,
      profile: null,
      now: NOW,
    })
    // One row for the pair: the cron row survives, the session row is
    // dropped, and the cut to 10 happens after the dedupe.
    const pairRows = (data.recent ?? []).filter((r) =>
      r.title.includes('Email Check Combined'),
    )
    expect(pairRows).toHaveLength(1)
    expect(pairRows[0]).toMatchObject({ kind: 'cron', who: 'cron' })
    expect(data.recent?.length).toBeLessThanOrEqual(10)
  })

  it('excludes workflow-run rows from recent when a profile is set (QA #3)', async () => {
    const { fetcher } = makeFetcher()
    const data = await buildDashboardSocial({
      fetcher,
      profile: 'neo',
      now: NOW,
    })
    // Workflow engine has no per-profile data — the fleet's run rows
    // must not pose as neo's activity.
    expect(data.recent?.every((r) => r.kind !== 'workflow')).toBe(true)
    // Sanity: the fleet view still shows them.
    const fleet = await buildDashboardSocial({
      fetcher,
      profile: null,
      now: NOW,
    })
    expect(fleet.recent?.some((r) => r.kind === 'workflow')).toBe(true)
  })

  it('drops stop-words, short words, numbers and hex/uuid-like ids from hot topics (QA #4)', async () => {
    const { fetcher } = makeFetcher()
    const wrapped: DashboardFetcher = (path) => {
      if (path.startsWith('/api/profiles/sessions')) {
        const rows = [
          {
            id: 't1',
            profile: 'hermes-switch',
            title: 'only run work sweep the memory layer',
            started_at: SEC(NOW),
            last_active: SEC(NOW),
            message_count: 1,
          },
          {
            id: 't2',
            profile: 'hermes-switch',
            title: 'f00d15ee and 3f2a9c1b7d ids with mnemosyne 42',
            started_at: SEC(NOW),
            last_active: SEC(NOW),
            message_count: 1,
          },
        ]
        return Promise.resolve(
          jsonResponse({
            sessions: rows,
            total: 2,
            profile_totals: { 'hermes-switch': 2 },
          }),
        )
      }
      return fetcher(path)
    }
    const data = await buildDashboardSocial({
      fetcher: wrapped,
      profile: null,
      now: NOW,
    })
    const labels = (data.hotTopics ?? []).map((t) => t.label)
    expect(labels).toContain('mnemosyne')
    expect(labels).toContain('sweep')
    expect(labels).toContain('memory')
    expect(labels).toContain('layer')
    for (const dropped of [
      'only',
      'run',
      'work',
      'f00d15ee',
      '3f2a9c1b7d',
      '42',
      'and',
      'the',
      'with',
      'ids',
    ]) {
      expect(labels).not.toContain(dropped)
    }
  })

  it('counts workflows from the definitions list; profile view stays 0 (QA #5)', async () => {
    const { fetcher } = makeFetcher()
    const data = await buildDashboardSocial({
      fetcher,
      profile: null,
      now: NOW,
    })
    // Known workflows = definitions count from
    // /api/plugins/workflow-engine/definitions — run_count is absent
    // on live legacy rows, so the old sum read 0.
    expect(data.counts?.workflows).toBe(definitionsFixture.definitions.length)
    const scoped = await buildDashboardSocial({
      fetcher,
      profile: 'neo',
      now: NOW,
    })
    expect(scoped.counts?.workflows).toBe(0)
  })

  it('does not let workflow sources alone keep counts alive for a set profile (A-R3 LOW #3)', async () => {
    const { fetcher } = makeFetcher({
      fail: {
        '/api/profiles/sessions': 'throw',
        '/api/cron/jobs': 'throw',
        '/api/plugins/karpathy-self-improve/experiments': 'throw',
        '/api/memory/activity': 'throw',
        '/api/plugins/kanban/board': 'throw',
      },
    })
    const data = await buildDashboardSocial({
      fetcher,
      profile: 'neo',
      now: NOW,
    })
    // Runs and definitions answered, but they are fleet-wide sources
    // the profile view excludes — counts must null, not show zeros.
    expect(data.counts).toBeNull()
  })
})

afterEach(() => {
  vi.useRealTimers()
})
