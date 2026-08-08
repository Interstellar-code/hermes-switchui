import { describe, expect, it, vi } from 'vitest'

import { sendLiveTestPrompt, verifyProviderVisible } from './verify-provider'

function modelsResponse(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as Response)
}

/** Fake clock so the poll's 20s budget costs no real time. */
function fakeTiming() {
  let clock = 0
  return {
    now: () => clock,
    sleep: (ms: number) => {
      clock += ms
      return Promise.resolve()
    },
  }
}

describe('verifyProviderVisible', () => {
  it('confirms once the gateway reports a real model', async () => {
    const fetchImpl = vi.fn(() =>
      modelsResponse({
        models: [{ id: 'claude-sonnet-4-6', provider: 'anthropic' }],
        configuredProviders: ['anthropic'],
      }),
    ) as unknown as typeof fetch

    const outcome = await verifyProviderVisible('anthropic', {
      fetchImpl,
      ...fakeTiming(),
    })
    expect(outcome.status).toBe('confirmed')
    expect(outcome.modelCount).toBe(1)
  })

  it('treats a lone synthetic `auto` row as pending a restart, not success', async () => {
    // This is the exact signal that the config landed but the gateway has not
    // reloaded — reporting it as success is what made the old flow lie.
    const fetchImpl = vi.fn(() =>
      modelsResponse({
        models: [{ id: 'auto', provider: 'manifest' }],
        configuredProviders: ['manifest'],
      }),
    ) as unknown as typeof fetch

    const outcome = await verifyProviderVisible('manifest', {
      fetchImpl,
      timeoutMs: 3_000,
      intervalMs: 1_000,
      ...fakeTiming(),
    })
    expect(outcome.status).toBe('pending-restart')
    expect(outcome.modelCount).toBe(0)
  })

  it('reports missing when the provider never appears', async () => {
    const fetchImpl = vi.fn(() =>
      modelsResponse({ models: [], configuredProviders: [] }),
    ) as unknown as typeof fetch

    const outcome = await verifyProviderVisible('groq', {
      fetchImpl,
      timeoutMs: 3_000,
      intervalMs: 1_000,
      ...fakeTiming(),
    })
    expect(outcome.status).toBe('missing')
  })

  it('keeps polling through a network error, as happens during a restart', async () => {
    let call = 0
    const fetchImpl = vi.fn(() => {
      call += 1
      if (call === 1) return Promise.reject(new Error('ECONNREFUSED'))
      return modelsResponse({
        models: [{ id: 'glm-4.6', provider: 'manifest' }],
        configuredProviders: ['manifest'],
      })
    }) as unknown as typeof fetch

    const outcome = await verifyProviderVisible('manifest', {
      fetchImpl,
      timeoutMs: 5_000,
      intervalMs: 1_000,
      ...fakeTiming(),
    })
    expect(outcome.status).toBe('confirmed')
    expect(call).toBeGreaterThan(1)
  })

  it('stops immediately when aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchImpl = vi.fn(() =>
      modelsResponse({ models: [], configuredProviders: [] }),
    ) as unknown as typeof fetch

    const outcome = await verifyProviderVisible('groq', {
      fetchImpl,
      signal: controller.signal,
      ...fakeTiming(),
    })
    expect(outcome.message).toBe('Verification cancelled.')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('matches the provider id case-insensitively', async () => {
    const fetchImpl = vi.fn(() =>
      modelsResponse({
        models: [{ id: 'x', provider: 'OpenRouter' }],
        configuredProviders: [],
      }),
    ) as unknown as typeof fetch

    const outcome = await verifyProviderVisible('openrouter', {
      fetchImpl,
      ...fakeTiming(),
    })
    expect(outcome.status).toBe('confirmed')
  })
})

describe('sendLiveTestPrompt', () => {
  it('reports success when the provider streams anything back', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve('data: {"delta":"ok"}'),
      } as Response),
    ) as unknown as typeof fetch

    expect(await sendLiveTestPrompt({ fetchImpl })).toEqual({
      ok: true,
      message: 'The provider answered a live prompt.',
    })
  })

  it('surfaces an HTTP failure verbatim', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve({ ok: false, status: 401 } as Response),
    ) as unknown as typeof fetch

    const result = await sendLiveTestPrompt({ fetchImpl })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('401')
  })

  it('reports an empty response rather than claiming success', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve('   '),
      } as Response),
    ) as unknown as typeof fetch

    expect((await sendLiveTestPrompt({ fetchImpl })).ok).toBe(false)
  })
})
