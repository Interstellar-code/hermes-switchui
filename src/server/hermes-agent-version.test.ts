import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AGENT_VERSION_TTL_MS,
  getAgentVersion,
  invalidateAgentVersion,
} from './hermes-agent-version'

// The real module starts `ensureGatewayProbed()` at import time, which fires
// its own fetches and would be counted by the assertions below. Only the URL is
// needed here.
vi.mock('./gateway-capabilities', () => ({
  CLAUDE_DASHBOARD_URL: 'http://127.0.0.1:9119',
}))

/**
 * The reader half. The comparator it feeds is tested in `agent-version.test.ts`.
 *
 * Every case here is about the cache, because the cache is where a version gate
 * goes wrong quietly: caching a failure would keep a freshly-started agent
 * "unknown" (and therefore below the floor) for the rest of the TTL, and
 * trusting a stale success would keep an agent that was downgraded looking new
 * enough.
 */
describe('getAgentVersion', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    invalidateAgentVersion()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    invalidateAgentVersion()
    vi.unstubAllGlobals()
  })

  function status(body: unknown, ok = true) {
    return {
      ok,
      json: () => Promise.resolve(body),
    }
  }

  it('reads `version` off the dashboard status endpoint', async () => {
    fetchMock.mockResolvedValue(status({ version: '0.19.16' }))
    await expect(getAgentVersion()).resolves.toBe('0.19.16')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/status$/)
  })

  it('serves a repeat read from the cache', async () => {
    fetchMock.mockResolvedValue(status({ version: '0.19.16' }))
    await getAgentVersion()
    await getAgentVersion()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('re-reads when forced or invalidated', async () => {
    fetchMock.mockResolvedValue(status({ version: '0.19.16' }))
    await getAgentVersion()
    await getAgentVersion({ force: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    invalidateAgentVersion()
    await getAgentVersion()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('never caches a failure — a starting dashboard is picked up immediately', async () => {
    // Caching a null would mean an agent that finished starting one second
    // after the miss stayed "unknown" — and therefore below the floor — for the
    // rest of the TTL.
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    await expect(getAgentVersion()).resolves.toBeNull()

    fetchMock.mockResolvedValue(status({ version: '0.19.16' }))
    await expect(getAgentVersion()).resolves.toBe('0.19.16')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('is null for a non-2xx, a versionless body, or a body that is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(status({ version: '0.19.16' }, false))
    await expect(getAgentVersion()).resolves.toBeNull()

    fetchMock.mockResolvedValueOnce(status({}))
    await expect(getAgentVersion()).resolves.toBeNull()

    fetchMock.mockResolvedValueOnce(status({ version: 19 }))
    await expect(getAgentVersion()).resolves.toBeNull()

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.reject(new Error('not json')),
    })
    await expect(getAgentVersion()).resolves.toBeNull()
  })

  it('expires the cache after its TTL', async () => {
    vi.useFakeTimers()
    try {
      fetchMock.mockResolvedValue(status({ version: '0.19.16' }))
      await getAgentVersion()
      vi.setSystemTime(Date.now() + AGENT_VERSION_TTL_MS + 1)
      await getAgentVersion()
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not trust a backwards clock jump to keep serving a stale version', async () => {
    vi.useFakeTimers()
    try {
      fetchMock.mockResolvedValue(status({ version: '0.19.16' }))
      await getAgentVersion()
      // NTP correction / sleep-wake: `now - at` goes negative, which would pass
      // a naive TTL test forever.
      vi.setSystemTime(Date.now() - 60_000)
      await getAgentVersion()
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('collapses concurrent reads into one request', async () => {
    fetchMock.mockResolvedValue(status({ version: '0.19.16' }))
    const [a, b] = await Promise.all([getAgentVersion(), getAgentVersion()])
    expect(a).toBe('0.19.16')
    expect(b).toBe('0.19.16')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
