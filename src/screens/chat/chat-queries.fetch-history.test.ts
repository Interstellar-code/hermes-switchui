// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CHAT_HISTORY_LIMIT,
  fetchHistory,
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
