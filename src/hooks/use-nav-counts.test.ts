import { afterEach, describe, expect, it, vi } from 'vitest'
import { countFromArray } from './use-nav-counts'

afterEach(() => vi.restoreAllMocks())

describe('countFromArray', () => {
  it('uses an API total instead of a truncated page length', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ skills: Array(200), total: 329 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    )

    await expect(
      countFromArray('/api/skills?tab=installed&limit=200', 'skills', 'total'),
    ).resolves.toBe(329)
  })

  it('falls back to the array length when no total is provided', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ profiles: [{ name: 'neo' }] }), {
            status: 200,
          }),
        ),
      ),
    )

    await expect(
      countFromArray('/api/profiles/list', 'profiles'),
    ).resolves.toBe(1)
  })
})
