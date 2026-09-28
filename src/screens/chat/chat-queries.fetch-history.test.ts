// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CHAT_HISTORY_LIMIT,
  fetchHistory,
  fetchProfileSessions,
  fetchSession,
  fetchSessions,
} from './chat-queries'
import { setSessionProfile } from '@/lib/session-scope'

afterEach(() => {
  vi.restoreAllMocks()
  setSessionProfile(null)
})

describe('fetchHistory', () => {
  it('requests a bounded tail by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ sessionKey: 'session-1', messages: [] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await fetchHistory({
      sessionKey: 'session-1',
      friendlyId: 'friendly-1',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `/api/history?limit=${DEFAULT_CHAT_HISTORY_LIMIT}&sessionKey=session-1&friendlyId=friendly-1`,
    )
  })

  it('carries the scoped profile so the transcript comes from that profile', () => {
    // Session ids repeat across profiles. Unscoped, this read returns the
    // active profile's same-id session and renders it as the scoped chat's
    // transcript — or nothing at all, which looks like the conversation was
    // lost on reload.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ sessionKey: 'session-1', messages: [] }),
    })
    vi.stubGlobal('fetch', fetchMock)
    setSessionProfile('neo')

    void fetchHistory({ sessionKey: 'session-1', friendlyId: 'friendly-1' })

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `/api/history?limit=${DEFAULT_CHAT_HISTORY_LIMIT}&sessionKey=session-1&friendlyId=friendly-1&profile=neo`,
    )
  })
})

describe('session reads', () => {
  it('carries the selected profile in list and individual-session reads', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ sessions: [] }),
    })
    vi.stubGlobal('fetch', fetchMock)
    setSessionProfile('morpheus')

    await fetchSessions()
    await fetchSession('session-1')

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/sessions?limit=200&offset=0&exclude_sources=cron&profile=morpheus',
      '/api/sessions?limit=200&offset=0&source=cron&profile=morpheus',
      '/api/sessions?sessionKey=session-1&profile=morpheus',
    ])
  })

  it('splits the profile-browse list into the same two windows', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ sessions: [] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await fetchProfileSessions('hermes-switch')

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/sessions?limit=200&offset=0&exclude_sources=cron&profile=hermes-switch',
      '/api/sessions?limit=200&offset=0&source=cron&profile=hermes-switch',
    ])
  })

  it('keeps chats visible when cron runs outnumber them', async () => {
    // One newest-N window let cron volume push every chat out of the list.
    const row = (key: string, updatedAt: number) => ({ key, updatedAt })
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            sessions: url.includes('source=cron')
              ? [row('cron_2', 30), row('dup', 20)]
              : [row('chat_1', 10), row('dup', 20)],
          }),
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const sessions = await fetchSessions()

    expect(sessions.map((s) => s.key)).toEqual(['cron_2', 'dup', 'chat_1'])
  })
})
