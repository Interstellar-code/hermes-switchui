import { afterEach, describe, expect, it, vi } from 'vitest'

import { getLogs } from './hermes-client'

describe('hermes-client getLogs', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls the same-origin /api/logs route directly', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ lines: ['ok'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(
      getLogs({ file: 'gateway', lines: 7, level: 'warn', component: 'matrix3d' }),
    ).resolves.toEqual({ lines: ['ok'] })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/logs?lines=7&file=gateway&level=warn&component=matrix3d',
    )
  })
})
