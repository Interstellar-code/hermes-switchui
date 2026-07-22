import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchHealth } from './self-improve-api'

// apiFetch is internal; exercise it through a public wrapper.
describe('apiFetch error handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('attaches the HTTP status to the thrown error on non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: () => Promise.resolve({ error: 'patch conflict' }),
      }),
    )
    await expect(fetchHealth()).rejects.toMatchObject({
      status: 422,
      message: 'patch conflict',
    })
  })

  it('resolves the parsed body on 2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            ok: true,
            plugin: 'karpathy',
            version: '1.0.0',
            db_path: null,
            db_exists: true,
          }),
      }),
    )
    await expect(fetchHealth()).resolves.toEqual({
      ok: true,
      plugin: 'karpathy',
      version: '1.0.0',
      db_path: null,
      db_exists: true,
    })
  })
})
