import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearMainSessionResolutionCache,
  resolveMainSessionId,
  selectMainSessionId,
} from './main-session-resolver'
import type { ClaudeSession } from './hermes-api'

function makeSession(overrides: Partial<ClaudeSession> = {}): ClaudeSession {
  return {
    id: 'session-1',
    title: null,
    message_count: 0,
    ...overrides,
  }
}

afterEach(() => {
  clearMainSessionResolutionCache()
  vi.restoreAllMocks()
})

describe('selectMainSessionId', () => {
  it('prefers the most recent non-internal titled session', () => {
    const selected = selectMainSessionId([
      makeSession({ id: 'cron_123', title: 'Cron title', message_count: 99 }),
      makeSession({ id: 'session-a', title: 'session-a', message_count: 12 }),
      makeSession({ id: 'session-b', title: 'Real Title', message_count: 1 }),
    ])

    expect(selected).toBe('session-b')
  })

  it('falls back to the first non-internal session with messages', () => {
    const selected = selectMainSessionId([
      makeSession({ id: 'agent:main:ops-1', title: 'Ops', message_count: 5 }),
      makeSession({ id: 'session-a', title: 'session-a', message_count: 0 }),
      makeSession({ id: 'session-b', title: '', message_count: 4 }),
    ])

    expect(selected).toBe('session-b')
  })
})

describe('resolveMainSessionId', () => {
  it('caches the resolved value for the TTL window', async () => {
    const listSessions = vi
      .fn<() => Promise<Array<ClaudeSession>>>()
      .mockResolvedValue([makeSession({ id: 'session-b', title: 'Real Title' })])

    const first = await resolveMainSessionId({ listSessions, ttlMs: 60_000 })
    const second = await resolveMainSessionId({ listSessions, ttlMs: 60_000 })

    expect(first).toBe('session-b')
    expect(second).toBe('session-b')
    expect(listSessions).toHaveBeenCalledTimes(1)
  })
})
