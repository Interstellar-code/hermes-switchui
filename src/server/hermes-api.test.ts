import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listSessions, toSessionSummary, updateSession } from './hermes-api'

vi.mock('@/lib/feature-gates', () => ({
  getCapabilities: () => ({ dashboard: { available: false } }),
}))

describe('toSessionSummary', () => {
  it('maps archived/pinned (0/1 and bool) to booleans', () => {
    expect(
      toSessionSummary({ uuid: '1', archived: 1, pinned: 0 } as any).archived,
    ).toBe(true)
    expect(
      toSessionSummary({ uuid: '1', archived: 1, pinned: 0 } as any).pinned,
    ).toBe(false)
    expect(
      toSessionSummary({ uuid: '2', archived: true, pinned: false } as any)
        .archived,
    ).toBe(true)
    expect(
      toSessionSummary({ uuid: '2', archived: true, pinned: false } as any)
        .pinned,
    ).toBe(false)
    expect(
      toSessionSummary({ uuid: '3', archived: false, pinned: 1 } as any)
        .archived,
    ).toBe(false)
    expect(
      toSessionSummary({ uuid: '3', archived: false, pinned: 1 } as any).pinned,
    ).toBe(true)
    expect(
      toSessionSummary({
        uuid: '4',
        archived: undefined,
        pinned: undefined,
      } as any).archived,
    ).toBe(false)
    expect(
      toSessionSummary({
        uuid: '4',
        archived: undefined,
        pinned: undefined,
      } as any).pinned,
    ).toBe(false)
  })
})

describe('listSessions fallback', () => {
  const originalFetch = global.fetch
  beforeEach(() => {
    global.fetch = vi.fn()
  })
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('reads data instead of items from gateway response', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ uuid: '123' }] })),
    )
    const sessions = await listSessions()
    expect(sessions).toEqual([{ uuid: '123' }])
  })

  it('tolerates items as fallback', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [{ uuid: '456' }] })),
    )
    const sessions = await listSessions()
    expect(sessions).toEqual([{ uuid: '456' }])
  })
})

describe('flag writes and archived reads (review r2)', () => {
  const originalFetch = global.fetch
  beforeEach(() => {
    global.fetch = vi.fn()
  })
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('a gateway PATCH failure carries the HTTP status, not only message text', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response('{"error":{"message":"Session not found: x"}}', {
        status: 404,
      }),
    )
    const err = await updateSession('x', { archived: true }).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(Error)
    expect((err as { status?: number }).status).toBe(404)
  })

  it('archived=only on the gateway fallback returns archived rows, never the unarchived window', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            { id: 'live', archived: 0 },
            { id: 'old', archived: 1 },
          ],
        }),
      ),
    )
    const sessions = await listSessions(50, 0, undefined, 'only')
    expect(sessions.map((s) => s.id)).toEqual(['old'])
  })
})
