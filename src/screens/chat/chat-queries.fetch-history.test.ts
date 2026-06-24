import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CHAT_HISTORY_LIMIT,
  fetchHistory,
} from './chat-queries'

afterEach(() => {
  vi.restoreAllMocks()
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
})
