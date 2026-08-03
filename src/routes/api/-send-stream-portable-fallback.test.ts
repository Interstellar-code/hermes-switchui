import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * P5 case 5 — the `/v1/responses` -> `/v1/chat/completions` fallback in
 * send-stream.ts's portable branch must not become an unscoped escape hatch.
 *
 * A profile-scope failure (409/404, typed) proves the topology can't honour
 * the prefix; retrying unprefixed against `openaiChat` would be exactly the
 * silent cross-profile write the whole mechanism exists to prevent. Any OTHER
 * failure (network blip, older agent without /v1/responses) is fine to fall
 * back on, but the fallback call must still carry the same `profile` — never
 * drop it on the way down.
 *
 * Drives the REAL POST handler (not a reimplementation of its logic) with
 * every dependency module mocked, following the pattern in
 * `-sessions.test.ts`. profile-scope is mocked (not partial) for the same
 * reason noted there: `vi.resetModules()` between tests would otherwise
 * re-evaluate the real module and break `isProfileScopeError` identity
 * checks against an error thrown by a stale class reference.
 */

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (_path: string) => (opts: unknown) => ({
    options: opts,
    ...(opts as object),
  }),
}))

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: () => true,
}))

vi.mock('../../server/rate-limit', () => ({
  requireJsonContentType: () => undefined,
}))

vi.mock('../../server/session-utils', () => ({
  resolveSessionKey: vi.fn(async () => ({ sessionKey: 'sess-fallback-1' })),
}))

vi.mock('../../server/gateway-capabilities', () => ({
  getChatMode: vi.fn(() => 'portable'),
}))

vi.mock('../../server/local-session-store', () => ({
  appendLocalMessage: vi.fn(),
  ensureLocalSession: vi.fn(),
  getLocalMessages: vi.fn(() => []),
  touchLocalSession: vi.fn(),
}))

vi.mock('../../server/local-provider-discovery', () => ({
  getDiscoveredModels: vi.fn(() => []),
  getLocalProviderDef: vi.fn(),
}))

vi.mock('../../server/main-session-resolver', () => ({
  resolveMainSessionId: vi.fn(),
}))

vi.mock('../../server/chat-event-bus', () => ({
  publishChatEvent: vi.fn(),
}))

vi.mock('../../server/send-run-tracker', () => ({
  registerActiveSendRun: vi.fn(),
  unregisterActiveSendRun: vi.fn(),
}))

vi.mock('../../server/run-store', () => ({
  appendRunText: vi.fn(),
  createPersistedRun: vi.fn(async () => null),
  markRunStatus: vi.fn(),
  setRunThinking: vi.fn(),
  upsertRunToolCall: vi.fn(),
}))

vi.mock('./-send-stream-orphan-tools', () => ({
  resolveOrphanedToolCards: vi.fn(() => []),
}))

vi.mock('./-send-stream-live-tools', () => ({
  collectSyntheticLiveToolEvents: vi.fn(() => []),
  createSyntheticLiveToolTracker: vi.fn(),
}))

vi.mock('../../server/hermes-api', () => ({
  SESSIONS_API_UNAVAILABLE_MESSAGE: 'unavailable',
  createSession: vi.fn(),
  ensureGatewayProbed: vi.fn(async () => ({ sessions: true })),
  getGatewayCapabilities: vi.fn(() => ({ sessions: true })),
  getMessages: vi.fn(),
  listSessions: vi.fn(),
  streamChat: vi.fn(),
}))

// Fully mocked, same rationale as -sessions.test.ts: resetModules() between
// tests would otherwise make FakeProfileScopeError fail an `instanceof`
// check taken against a prior module instance's class.
class FakeProfileScopeError extends Error {}
const profileScope = vi.hoisted(() => ({
  readProfile: vi.fn((v: unknown) =>
    typeof v === 'string' && v.trim() ? v.trim() : null,
  ),
  assertProfileServed: vi.fn(async () => undefined),
  isProfileScopeError: vi.fn(),
  profileErrorStatus: vi.fn(() => 500),
}))
vi.mock('../../server/profile-scope', () => ({
  readProfile: profileScope.readProfile,
  assertProfileServed: profileScope.assertProfileServed,
  isProfileScopeError: profileScope.isProfileScopeError,
  profileErrorStatus: profileScope.profileErrorStatus,
}))

const responsesApi = vi.hoisted(() => ({ streamResponses: vi.fn() }))
vi.mock('../../server/responses-api', () => ({
  streamResponses: responsesApi.streamResponses,
}))

const openaiCompat = vi.hoisted(() => ({ openaiChat: vi.fn() }))
vi.mock('../../server/openai-compat-api', () => ({
  openaiChat: openaiCompat.openaiChat,
}))

type Handler = (ctx: { request: Request }) => Promise<Response>

async function getPostHandler(): Promise<Handler> {
  vi.resetModules()
  const mod = await import('./send-stream')
  return (
    mod.Route as unknown as {
      options: { server: { handlers: Record<string, Handler> } }
    }
  ).options.server.handlers.POST
}

function postRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/send-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  profileScope.isProfileScopeError.mockImplementation(
    (err: unknown) => err instanceof FakeProfileScopeError,
  )
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('portable /v1/responses -> /v1/chat/completions fallback', () => {
  it('rethrows a profile-scope failure instead of falling back to openaiChat', async () => {
    process.env.HERMES_USE_RESPONSES = '1'
    const scopeErr = new FakeProfileScopeError(
      'Profile "neo" is not served by this gateway.',
    )
    // eslint-disable-next-line require-yield -- intentionally throws before ever yielding, modeling an async generator that fails on first iteration
    responsesApi.streamResponses.mockImplementation(async function* () {
      throw scopeErr
    })
    openaiCompat.openaiChat.mockImplementation(async function* () {})

    const handler = await getPostHandler()
    const res = await handler({
      request: postRequest({ message: 'hi', profile: 'neo' }),
    })
    const text = await res.text()

    // The typed failure reached the client as the stream's error event...
    expect(text).toContain('event: error')
    const errorLine = text
      .split('\n')
      .find((line) => line.startsWith('data:') && line.includes('"message"'))
    expect(errorLine).toBeDefined()
    const errorPayload = JSON.parse(errorLine!.slice('data:'.length)) as {
      message: string
    }
    expect(errorPayload.message).toBe(
      'Profile "neo" is not served by this gateway.',
    )
    // ...and openaiChat was never reached: no unscoped retry happened.
    expect(openaiCompat.openaiChat).not.toHaveBeenCalled()
    expect(responsesApi.streamResponses).toHaveBeenCalledWith(
      expect.objectContaining({ profile: 'neo' }),
    )

    delete process.env.HERMES_USE_RESPONSES
  })

  it('falls back to openaiChat on a non-profile-scope failure, carrying the same profile', async () => {
    process.env.HERMES_USE_RESPONSES = '1'
    // eslint-disable-next-line require-yield -- intentionally throws before ever yielding, modeling an async generator that fails on first iteration
    responsesApi.streamResponses.mockImplementation(async function* () {
      throw new Error('ECONNRESET')
    })
    openaiCompat.openaiChat.mockImplementation(async function* () {})

    const handler = await getPostHandler()
    const res = await handler({
      request: postRequest({ message: 'hi', profile: 'neo' }),
    })
    const text = await res.text()

    expect(text).toContain('event: done')
    expect(openaiCompat.openaiChat).toHaveBeenCalledTimes(1)
    expect(openaiCompat.openaiChat.mock.calls[0][1]).toEqual(
      expect.objectContaining({ profile: 'neo' }),
    )

    delete process.env.HERMES_USE_RESPONSES
  })

  it('never calls openaiChat unscoped after a profile-scope failure (no silent downgrade)', async () => {
    // Belt-and-suspenders on the first test: even if a future edit made the
    // rethrow swallow the error instead of propagating it, the fallback call
    // itself must never be reached at all for a profile-scope failure.
    process.env.HERMES_USE_RESPONSES = '1'
    // eslint-disable-next-line require-yield -- intentionally throws before ever yielding, modeling an async generator that fails on first iteration
    responsesApi.streamResponses.mockImplementation(async function* () {
      throw new FakeProfileScopeError('nope')
    })
    openaiCompat.openaiChat.mockImplementation(async function* () {})

    const handler = await getPostHandler()
    await (
      await handler({ request: postRequest({ message: 'hi', profile: 'neo' }) })
    ).text()

    expect(openaiCompat.openaiChat).not.toHaveBeenCalled()
    delete process.env.HERMES_USE_RESPONSES
  })
})
