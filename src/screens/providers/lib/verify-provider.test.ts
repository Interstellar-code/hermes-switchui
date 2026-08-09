import { describe, expect, it, vi } from 'vitest'

import {
  looksLikeCredentialFailure,
  parseLiveTestStream,
  sendLiveTestPrompt,
  verifyProviderAfterSave,
  verifyProviderVisible,
} from './verify-provider'

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
      Promise.resolve({
        ok: false,
        status: 401,
        text: () => Promise.resolve(''),
      } as Response),
    ) as unknown as typeof fetch

    const result = await sendLiveTestPrompt({ fetchImpl })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('401')
  })

  // The old implementation returned `ok: true` for this body, because it
  // treated any non-empty text as a reply. An SSE error event IS non-empty
  // text, so a 401 from the provider rendered as "the provider answered".
  it('fails on an SSE error event and repeats the gateway message', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            'event: error\ndata: {"message":"401 Unauthorized from api.example.com"}\n\n',
          ),
      } as Response),
    ) as unknown as typeof fetch

    const result = await sendLiveTestPrompt({ fetchImpl })
    expect(result.ok).toBe(false)
    expect(result.message).toBe('401 Unauthorized from api.example.com')
    expect(result.gatewayError).toBe('401 Unauthorized from api.example.com')
  })

  it('handles the non-stream JSON error body too', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        text: () => Promise.resolve('{"ok":false,"error":"invalid_api_key"}'),
      } as Response),
    ) as unknown as typeof fetch

    expect((await sendLiveTestPrompt({ fetchImpl })).message).toBe(
      'invalid_api_key',
    )
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

describe('parseLiveTestStream', () => {
  it('finds the first error and ignores later content', () => {
    expect(
      parseLiveTestStream(
        'event: error\ndata: {"message":"boom"}\n\nevent: token\ndata: {"text":"hi"}\n',
      ).error,
    ).toBe('boom')
  })

  it('reports content with no error for a clean stream', () => {
    expect(
      parseLiveTestStream(
        'event: token\ndata: {"text":"ok"}\n\ndata: [DONE]\n',
      ),
    ).toEqual({ error: null, sawContent: true })
  })
})

describe('verifyProviderAfterSave', () => {
  /** Models says confirmed; the live prompt 401s. */
  function fetchWith(liveBody: string) {
    return vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/api/models')) {
        return modelsResponse({
          models: [{ id: 'm1', provider: 'manifest' }],
          configuredProviders: ['manifest'],
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(liveBody),
      } as Response)
    }) as unknown as typeof fetch
  }

  it('flags a credential failure when the provider resolves but rejects the key', async () => {
    const outcome = await verifyProviderAfterSave('manifest', {
      fetchImpl: fetchWith(
        'event: error\ndata: {"message":"401 invalid_api_key"}\n',
      ),
      ...fakeTiming(),
    })
    expect(outcome.resolution.status).toBe('confirmed')
    expect(outcome.live?.ok).toBe(false)
    expect(outcome.credentialFailed).toBe(true)
  })

  it('does not flag a credential failure for an unrelated error', async () => {
    const outcome = await verifyProviderAfterSave('manifest', {
      fetchImpl: fetchWith(
        'event: error\ndata: {"message":"upstream timeout"}\n',
      ),
      ...fakeTiming(),
    })
    expect(outcome.credentialFailed).toBe(false)
  })

  it('skips the live prompt when the provider is not visible yet', async () => {
    const fetchImpl = vi.fn(() =>
      modelsResponse({ models: [], configuredProviders: [] }),
    ) as unknown as typeof fetch
    const outcome = await verifyProviderAfterSave('manifest', {
      fetchImpl,
      ...fakeTiming(),
    })
    expect(outcome.resolution.status).toBe('missing')
    expect(outcome.live).toBeNull()
  })
})

describe('looksLikeCredentialFailure', () => {
  // The onboarding first-chat gate (`onboarding/lib/first-chat.ts`) used to
  // carry a second, broader copy of this regex — `\w*` on `unauthor`,
  // `authentication` and `credential` — that this module's copy did not
  // match. The two have been consolidated onto this (the broader) pattern;
  // these are exactly the shapes the onboarding copy caught that the old
  // provider-screen copy did not.
  it('recognises the shapes providers actually return, including the `_error`-suffixed codes', () => {
    for (const message of [
      'Error code: 401 - invalid x-api-key',
      '403 Forbidden',
      'invalid_api_key',
      'authentication_error',
      'credential_error',
      'unauthorized_client',
      'No API key provided',
    ]) {
      expect(looksLikeCredentialFailure(message), message).toBe(true)
    }
  })

  it('does not misread an outage as a credential problem', () => {
    for (const message of [
      'connection refused',
      'The provider did not answer within 30 seconds.',
      'model not found',
    ]) {
      expect(looksLikeCredentialFailure(message), message).toBe(false)
    }
  })
})
