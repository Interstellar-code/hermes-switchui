import { beforeEach, describe, expect, it, vi } from 'vitest'

import { readContextUsage } from './context-usage'

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
