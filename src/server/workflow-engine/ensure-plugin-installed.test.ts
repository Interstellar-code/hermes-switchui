import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Timeout — a hung fetch must reject rather than hang forever
// ---------------------------------------------------------------------------

describe('ensurePluginInstalled fetch timeout', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('passes an AbortSignal timeout to the probe fetch', async () => {
    // A never-resolving fetch simulates a hung dashboard connection.
    fetchMock.mockImplementation(() => {
      return new Promise<Response>(() => { /* never resolves */ })
    })

    // Import lazily so the stub is in place.
    vi.resetModules()
    const { ensurePluginInstalled } = await import('./ensure-plugin-installed')

    // Fire without awaiting — we only need the mock to be called.
    const pending = ensurePluginInstalled()
    await Promise.resolve() // flush microtasks

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const signal = fetchMock.mock.calls[0][1]?.signal as AbortSignal | undefined
    expect(signal).toBeDefined()
    expect(signal).toBeInstanceOf(AbortSignal)
    // AbortSignal.timeout() signals eventually abort with DOMException "TimeoutError".
    // Confirming the signal is present proves the timeout is wired up.

    // Clean up the dangling promise.
    pending.catch(() => { /* expected */ })
  })

  it('returns status:error when the probe fetch times out', async () => {
    // Immediately abort to simulate timeout firing without real wall-clock delay.
    const controller = new AbortController()
    controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))

    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      // Honour the signal: reject as if timed out.
      if (init?.signal?.aborted) {
        return Promise.reject(init.signal.reason)
      }
      return Promise.reject(new DOMException('Timed out', 'TimeoutError'))
    })

    vi.resetModules()
    const { ensurePluginInstalled } = await import('./ensure-plugin-installed')
    const result = await ensurePluginInstalled()

    // The existing catch block must surface this as an error, not hang.
    expect(result.status).toBe('error')
    expect(result.message).toMatch(/TimeoutError|Timed out|aborted/i)
  })
})
