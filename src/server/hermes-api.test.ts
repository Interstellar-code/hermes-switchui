import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listSessions, toSessionSummary } from './hermes-api'

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
