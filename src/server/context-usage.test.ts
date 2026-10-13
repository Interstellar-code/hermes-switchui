import { beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetContextUsageCache, readContextUsage } from './context-usage'

const gw = vi.hoisted(() => ({ dashboardFetch: vi.fn() }))
const profile = vi.hoisted(() => ({ config: {} }))

vi.mock('@/server/gateway-capabilities', () => ({
  BEARER_TOKEN: '',
  CLAUDE_API: 'http://gw',
  dashboardFetch: gw.dashboardFetch,
  ensureGatewayProbed: async () => ({ dashboard: { available: true } }),
  getCapabilities: () => ({ dashboard: { available: true } }),
}))
vi.mock('@/server/local-session-store', () => ({
  getLocalSession: () => null,
  getLocalMessages: () => [],
}))
vi.mock('@/server/profile-scope', () => ({
  scopedPath: async (p: string) => p,
}))
vi.mock('@/server/profiles-browser', () => ({
  getActiveProfileName: () => 'p',
  readProfile: () => ({ config: profile.config }),
}))

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 })

// 14 messages, 700 chars each → 9800 chars ≈ 2800 tokens; cache reads are
// cumulative and would read as ~178k under the old heuristic.
function mockSession(extra: Record<string, unknown> = {}) {
  gw.dashboardFetch.mockImplementation(async (url: string) =>
    url.includes('/messages')
      ? json({
          messages: Array.from({ length: 14 }, () => ({
            content: 'x'.repeat(700),
          })),
        })
      : json({
          id: 's1',
          model: 'auto',
          message_count: 14,
          cache_read_tokens: 1_039_104,
          ...extra,
        }),
  )
}

describe('readContextUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetContextUsageCache()
    profile.config = {
      model: { default: 'auto', provider: 'manifest' },
      providers: {
        manifest: { models: { auto: { context_length: 750_000 } } },
      },
      compression: { enabled: true, threshold: 0.75 },
    }
  })

  it('takes the window and threshold from config.yaml and estimates from the transcript', async () => {
    mockSession()
    const u = await readContextUsage('s1')
    expect(u.maxTokens).toBe(750_000)
    expect(u.maxSource).toBe('config')
    expect(u.compressionThreshold).toBe(0.75)
    expect(u.estimated).toBe(true)
    expect(u.usedTokens).toBe(2800)
  })

  it('prefers the gateway last-prompt count and window when reported', async () => {
    mockSession({ last_prompt_tokens: 120_000, context_length: 400_000 })
    const u = await readContextUsage('s1')
    expect(u).toMatchObject({
      usedTokens: 120_000,
      maxTokens: 400_000,
      maxSource: 'gateway',
      estimated: false,
      contextPercent: 30,
    })
  })

  it('marks an unknown window as default and drops a disabled threshold', async () => {
    profile.config = { compression: { enabled: false, threshold: 0.5 } }
    mockSession()
    const u = await readContextUsage('s1')
    expect(u.maxSource).toBe('default')
    expect(u.maxTokens).toBe(200_000)
    expect(u.compressionThreshold).toBeNull()
  })
})

const callsFor = (url: string) =>
  gw.dashboardFetch.mock.calls.filter(([u]) => u === url)

describe('readContextUsage caching (perf-pass2 S1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    __resetContextUsageCache()
    profile.config = {
      model: { default: 'auto', provider: 'manifest' },
      providers: {
        manifest: { models: { auto: { context_length: 750_000 } } },
      },
      compression: { enabled: true, threshold: 0.75 },
    }
  })

  it('uses a prefetched session row instead of refetching it', async () => {
    mockSession()
    const u = await readContextUsage('s1', null, {
      id: 's1',
      model: 'auto',
      message_count: 14,
      cache_read_tokens: 1_039_104,
    })
    expect(callsFor('/api/sessions/s1')).toHaveLength(0)
    expect(callsFor('/api/sessions/s1/messages')).toHaveLength(1)
    expect(u.usedTokens).toBe(2800)
  })

  it('shares one upstream fetch between concurrent calls', async () => {
    mockSession()
    const [a, b] = await Promise.all([
      readContextUsage('s1'),
      readContextUsage('s1'),
    ])
    expect(a).toEqual(b)
    expect(callsFor('/api/sessions/s1')).toHaveLength(1)
    expect(callsFor('/api/sessions/s1/messages')).toHaveLength(1)
  })

  it('refetches the snapshot after the 5 s TTL', async () => {
    vi.useFakeTimers()
    try {
      mockSession()
      await readContextUsage('s1')
      expect(callsFor('/api/sessions/s1')).toHaveLength(1)
      vi.advanceTimersByTime(6_000)
      await readContextUsage('s1')
      expect(callsFor('/api/sessions/s1')).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('refetches the transcript only when message_count changes', async () => {
    vi.useFakeTimers()
    try {
      mockSession()
      await readContextUsage('s1')
      expect(callsFor('/api/sessions/s1/messages')).toHaveLength(1)

      vi.advanceTimersByTime(6_000)
      // Snapshot TTL expired: the session row is fetched again, but the
      // estimate is still keyed to the same message_count, so the
      // transcript is NOT refetched.
      const unchanged = await readContextUsage('s1')
      expect(callsFor('/api/sessions/s1')).toHaveLength(2)
      expect(callsFor('/api/sessions/s1/messages')).toHaveLength(1)
      expect(unchanged.usedTokens).toBe(2800)

      vi.advanceTimersByTime(6_000)
      mockSession({ message_count: 15 })
      const grown = await readContextUsage('s1')
      expect(callsFor('/api/sessions/s1')).toHaveLength(3)
      expect(callsFor('/api/sessions/s1/messages')).toHaveLength(2)
      expect(grown.usedTokens).toBe(2800)
    } finally {
      vi.useRealTimers()
    }
  })

  it('never shares a cache entry across profiles', async () => {
    mockSession()
    const [a, b] = await Promise.all([
      readContextUsage('s1', 'alpha'),
      readContextUsage('s1', 'beta'),
    ])
    expect(a).toEqual(b)
    expect(callsFor('/api/sessions/s1?profile=alpha')).toHaveLength(1)
    expect(callsFor('/api/sessions/s1?profile=beta')).toHaveLength(1)
    // A cached hit for one profile must not serve the other profile.
    await readContextUsage('s1', 'alpha')
    expect(callsFor('/api/sessions/s1?profile=alpha')).toHaveLength(1)
    expect(callsFor('/api/sessions/s1?profile=beta')).toHaveLength(1)
  })

  it('holds an empty snapshot for at most ~1 s', async () => {
    vi.useFakeTimers()
    try {
      gw.dashboardFetch.mockImplementation(
        async () => new Response('boom', { status: 503 }),
      )
      const first = await readContextUsage('s1')
      expect(first.usedTokens).toBe(0)
      // Inside the short window the cached empty snapshot serves the call.
      await readContextUsage('s1')
      expect(callsFor('/api/sessions/s1')).toHaveLength(1)
      vi.advanceTimersByTime(1_100)
      await readContextUsage('s1')
      expect(callsFor('/api/sessions/s1')).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
