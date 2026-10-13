import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Route } from './session-status'
import { __resetContextUsageCache } from '@/server/context-usage'

// perf-pass2 S1 acceptance: only the network boundary (dashboardFetch) and
// the profile config are stubbed. The route handler, the hermes-api client,
// and readContextUsage all run for real; upstream cost is asserted by
// counting dashboardFetch calls.
const gw = vi.hoisted(() => ({ dashboardFetch: vi.fn() }))
const profile = vi.hoisted(() => ({ config: {} }))

const capabilities = vi.hoisted(() => ({
  dashboard: { available: true },
  sessions: true,
  // config: false keeps getConfigCached out of the fetch count.
  config: false,
}))

vi.mock('@/server/gateway-capabilities', () => ({
  BEARER_TOKEN: '',
  CLAUDE_API: 'http://gw',
  CLAUDE_DASHBOARD_URL: 'http://dash',
  SESSIONS_API_UNAVAILABLE_MESSAGE: 'sessions api unavailable',
  probeGateway: async () => capabilities,
  dashboardFetch: gw.dashboardFetch,
  ensureGatewayProbed: async () => capabilities,
  getCapabilities: () => capabilities,
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

// Keep the no-password auth path deterministic even if the developer shell
// exports one; isAuthenticated stays real.
delete process.env.HERMES_PASSWORD
delete process.env.CLAUDE_PASSWORD

// Live shape observed for 20260929_111016_a36ce138: last_prompt_tokens 0 and
// message_count 310 — the case that used to refetch the whole 1.5 MB
// transcript on every poll. 310 messages * 700 chars / 3.5 = 62_000 tokens.
const SESSION_ID = '20260929_111016_a36ce138'
const SESSION_URL = `/api/sessions/${SESSION_ID}`
const MESSAGES_URL = `/api/sessions/${SESSION_ID}/messages`

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 })

function mockLiveSession(extra: Record<string, unknown> = {}) {
  gw.dashboardFetch.mockImplementation(async (url: string) =>
    String(url).includes('/messages')
      ? json({
          messages: Array.from({ length: 310 }, () => ({
            content: 'x'.repeat(700),
          })),
        })
      : json({
          id: SESSION_ID,
          source: 'chat',
          title: 'perf pass 2',
          model: 'auto',
          started_at: 1_759_000_000,
          ended_at: null,
          end_reason: null,
          message_count: 310,
          tool_call_count: 42,
          input_tokens: 1_000,
          output_tokens: 2_000,
          cache_read_tokens: 1_039_104,
          reasoning_tokens: 300,
          last_prompt_tokens: 0,
          effective_context_length: 200_000,
          is_active: true,
          ...extra,
        }),
  )
}

const callsFor = (url: string) =>
  gw.dashboardFetch.mock.calls.filter(([u]) => u === url)

const pollRequest = () =>
  new Request(`http://localhost/api/session-status?sessionKey=${SESSION_ID}`)

const handler = (Route as any).options.server.handlers.GET as ({
  request: Request,
}) => Promise<Response>

describe('/api/session-status upstream cost (perf-pass2 S1)', () => {
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

  it('answers a non-local poll with exactly 2 upstream fetches (session row + transcript), not 3', async () => {
    mockLiveSession()
    const response = await handler({ request: pollRequest() })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.ok).toBe(true)
    expect(body.payload).toMatchObject({
      sessionKey: SESSION_ID,
      status: 'idle',
      usedTokens: 62_000,
      maxTokens: 200_000,
      contextPercent: 31,
      estimated: true,
    })
    // The duplicate `/api/sessions/<id>` fetch inside readContextUsage is
    // gone: exactly one session-row fetch and one transcript fetch.
    expect(callsFor(SESSION_URL)).toHaveLength(1)
    expect(callsFor(MESSAGES_URL)).toHaveLength(1)
    expect(gw.dashboardFetch).toHaveBeenCalledTimes(2)
  })

  it('serves a repeat poll inside the cache TTL without refetching the duplicate row or transcript', async () => {
    mockLiveSession()
    const first = await handler({ request: pollRequest() })
    const second = await handler({ request: pollRequest() })

    const firstBody = await first.json()
    const secondBody = await second.json()
    expect(secondBody).toEqual(firstBody)
    // The repeat poll still fetches the session row via getSession (the
    // route's own read), but readContextUsage adds nothing: no duplicate
    // row fetch and no transcript refetch. Old code: 6 fetches by now.
    expect(callsFor(SESSION_URL)).toHaveLength(2)
    expect(callsFor(MESSAGES_URL)).toHaveLength(1)
    expect(gw.dashboardFetch).toHaveBeenCalledTimes(3)
  })
})
