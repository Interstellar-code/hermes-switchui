import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, apiJson } from './api-fetch'

describe('apiFetch', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('adds JSON Content-Type to mutating requests', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }))
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      await apiFetch('/x', { method })
    }
    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit
      expect((init.headers as Record<string, string>)['Content-Type']).toBe(
        'application/json',
      )
    }
  })

  it('leaves GET requests untouched (no Content-Type injected)', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))
    await apiFetch('/x')
    const init = (fetchMock.mock.calls[0][1] ?? {})
    expect(init.headers).toBeUndefined()
  })

  it('lets a caller-supplied Content-Type win', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }))
    await apiFetch('/x', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
    })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'text/plain',
    )
  })
})

describe('apiJson', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns undefined on 204 (no JSON parse)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 204 }),
    )
    await expect(apiJson('/x', { method: 'DELETE' })).resolves.toBeUndefined()
  })

  it('tolerates an empty 200 body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 200 }),
    )
    await expect(apiJson('/x')).resolves.toEqual({})
  })

  it('parses a JSON body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    await expect(apiJson('/x')).resolves.toEqual({ ok: true })
  })

  it('throws with the server error message on non-ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'nope' }), { status: 400 }),
    )
    await expect(apiJson('/x', { method: 'POST' })).rejects.toThrow('nope')
  })
})
